-- ============================================================================
-- migration_v11_vendor_active_order.sql
-- ----------------------------------------------------------------------------
-- Corrige la faille 🔴 la plus critique de l'audit V10 :
--
--   create_order_atomic() verrouillait et vérifiait vendors.is_open,
--   mais jamais vendors.is_active. Un vendeur désactivé par un admin
--   (is_active = false) mais resté "ouvert" (is_open = true, valeur
--   qui n'est plus modifiable une fois le vendeur désactivé) pouvait
--   donc encore recevoir des commandes via POST /api/orders, alors que
--   son propre espace vendeur lui était déjà interdit.
--
-- À exécuter APRÈS migration_client_room.sql (cible la signature à
-- 7 paramètres, avec p_client_room).
--
-- Idempotent : CREATE OR REPLACE, pas de DROP FUNCTION nécessaire car
-- la signature (types de paramètres) ne change pas.
-- ============================================================================

create or replace function create_order_atomic(
  p_client_id uuid,
  p_vendor_id uuid,
  p_items jsonb,
  p_payment_method_id uuid,
  p_is_debt boolean,
  p_debt_limit numeric,
  p_client_room text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_vendor_open boolean;
  v_vendor_active boolean;
  v_item jsonb;
  v_product_id uuid;
  v_qty int;
  v_price numeric;
  v_stock_id uuid;
  v_stock_qty int;
  v_total numeric := 0;
  v_payment_type text;
  v_api_key text;
  v_merchant_link text;
  v_is_active boolean;
  v_order_id uuid;
  v_status text;
  v_current_debt numeric;
  v_order_items jsonb := '[]'::jsonb;
  v_client_room text;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  v_client_room := nullif(trim(p_client_room), '');
  if v_client_room is null then
    raise exception 'CLIENT_ROOM_REQUIRED';
  end if;

  -- Verrouille la ligne du vendeur pour toute la durée de la transaction
  -- et vérifie À LA FOIS is_active (le vendeur n'a pas été désactivé par
  -- un admin) ET is_open (le vendeur a choisi d'être ouvert maintenant).
  select is_open, is_active into v_vendor_open, v_vendor_active
    from vendors where id = p_vendor_id for update;

  if v_vendor_active is distinct from true then
    raise exception 'VENDOR_INACTIVE';
  end if;

  if v_vendor_open is distinct from true then
    raise exception 'VENDOR_CLOSED';
  end if;

  if p_payment_method_id is not null then
    select type, api_key_encrypted, merchant_link, is_active
      into v_payment_type, v_api_key, v_merchant_link, v_is_active
    from payment_methods where id = p_payment_method_id;

    if v_payment_type is null then
      raise exception 'PAYMENT_METHOD_NOT_FOUND';
    end if;
    if not v_is_active then
      raise exception 'PAYMENT_METHOD_INACTIVE';
    end if;
  end if;

  if p_is_debt then
    if p_payment_method_id is not null then
      raise exception 'DEBT_CANNOT_HAVE_PAYMENT_METHOD';
    end if;
    v_status := 'confirmed';
  elsif v_payment_type = 'cash' then
    v_status := 'pending';
  elsif v_payment_type = 'wave' then
    v_status := 'pending';
  else
    raise exception 'UNSUPPORTED_PAYMENT_METHOD';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;

    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QUANTITY';
    end if;

    select vs.id, vs.quantity, p.price
      into v_stock_id, v_stock_qty, v_price
    from vendor_stock vs
    join products p on p.id = vs.product_id
    where vs.vendor_id = p_vendor_id
      and vs.product_id = v_product_id
      and p.is_archived = false
    for update of vs;

    if v_stock_id is null or v_stock_qty < v_qty then
      raise exception 'INSUFFICIENT_STOCK:%', v_product_id;
    end if;

    update vendor_stock set quantity = quantity - v_qty, updated_at = now()
      where id = v_stock_id;

    v_total := v_total + v_price * v_qty;
    v_order_items := v_order_items || jsonb_build_object(
      'product_id', v_product_id, 'quantity', v_qty, 'unit_price', v_price
    );
  end loop;

  if p_is_debt then
    perform pg_advisory_xact_lock(hashtext(p_client_id::text));
    select coalesce(sum(amount), 0) into v_current_debt
    from debts where client_id = p_client_id and is_repaid = false;

    if v_current_debt + v_total > p_debt_limit then
      raise exception 'DEBT_LIMIT_EXCEEDED';
    end if;
  end if;

  insert into orders (client_id, vendor_id, payment_method_id, is_debt, total, status, client_room)
  values (p_client_id, p_vendor_id, p_payment_method_id, p_is_debt, v_total, v_status, v_client_room)
  returning id into v_order_id;

  insert into order_items (order_id, product_id, quantity, unit_price)
  select v_order_id, (elem->>'product_id')::uuid, (elem->>'quantity')::int, (elem->>'unit_price')::numeric
  from jsonb_array_elements(v_order_items) elem;

  if p_is_debt then
    insert into debts (client_id, order_id, amount) values (p_client_id, v_order_id, v_total);
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'status', v_status,
    'total', v_total,
    'payment_type', v_payment_type,
    'api_key', v_api_key,
    'merchant_link', v_merchant_link
  );
end;
$$;

revoke execute on function create_order_atomic(uuid, uuid, jsonb, uuid, boolean, numeric, text)
  from public, anon, authenticated;
