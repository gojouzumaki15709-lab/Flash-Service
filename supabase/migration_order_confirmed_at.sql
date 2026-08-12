-- ============================================================
-- MIGRATION : horodatage de confirmation des commandes
-- Ajoute orders.confirmed_at (date + heure exacte de la validation
-- par le vendeur, ou du paiement Wave confirmé automatiquement) pour
-- permettre à l'admin de voir quand chaque commande a été validée,
-- en plus de quand elle a été créée (created_at).
-- ============================================================

alter table orders add column if not exists confirmed_at timestamptz;

-- Remplace create_order_atomic pour renseigner confirmed_at = now() dans le
-- cas d'une commande à crédit (confirmée immédiatement, sans passer par le
-- vendeur).
create or replace function create_order_atomic(
  p_client_id uuid,
  p_vendor_id uuid,
  p_items jsonb,
  p_payment_method_id uuid,
  p_is_debt boolean,
  p_debt_limit numeric
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_vendor_open boolean;
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
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  select is_open into v_vendor_open from vendors where id = p_vendor_id for update;
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

  if p_payment_method_id is null and v_merchant_link is null then
    v_merchant_link := null;
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
    where vs.vendor_id = p_vendor_id and vs.product_id = v_product_id
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

  insert into orders (client_id, vendor_id, payment_method_id, is_debt, total, status, confirmed_at)
  values (p_client_id, p_vendor_id, p_payment_method_id, p_is_debt, v_total, v_status,
          case when v_status = 'confirmed' then now() else null end)
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

-- Remplace confirm_vendor_order_atomic pour renseigner confirmed_at = now()
-- au moment de la confirmation manuelle par un vendeur.
create or replace function confirm_vendor_order_atomic(
  p_order_id uuid,
  p_vendor_id uuid,
  p_items jsonb,
  p_cash_amount_received numeric
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_status text;
  v_order_vendor_id uuid;
  v_is_debt boolean;
  v_payment_type text;
  v_api_key text;
  v_item record;
  v_final_qty int;
  v_diff int;
  v_new_total numeric := 0;
  v_amount_received numeric;
begin
  select o.status, o.vendor_id, o.is_debt, pm.type, pm.api_key_encrypted
    into v_status, v_order_vendor_id, v_is_debt, v_payment_type, v_api_key
  from orders o
  left join payment_methods pm on pm.id = o.payment_method_id
  where o.id = p_order_id
  for update of o;

  if v_order_vendor_id is null or v_order_vendor_id <> p_vendor_id then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_status <> 'pending' then
    raise exception 'ORDER_NOT_PENDING';
  end if;
  if v_payment_type = 'wave' and v_api_key is not null then
    raise exception 'WAVE_API_ORDER_CANNOT_BE_MANUALLY_CONFIRMED';
  end if;

  for v_item in
    select id, product_id, quantity, unit_price from order_items where order_id = p_order_id
  loop
    select coalesce((elem->>'quantity')::int, v_item.quantity)
      into v_final_qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) elem
    where (elem->>'order_item_id')::uuid = v_item.id;

    if v_final_qty is null then
      v_final_qty := v_item.quantity;
    end if;
    v_final_qty := greatest(0, least(v_final_qty, v_item.quantity));
    v_diff := v_item.quantity - v_final_qty;

    if v_diff > 0 then
      update vendor_stock set quantity = quantity + v_diff, updated_at = now()
      where vendor_id = p_vendor_id and product_id = v_item.product_id;
    end if;

    update order_items set quantity_taken = v_final_qty where id = v_item.id;
    v_new_total := v_new_total + v_final_qty * v_item.unit_price;
  end loop;

  v_amount_received := coalesce(p_cash_amount_received, v_new_total);
  if v_payment_type = 'cash' and v_amount_received < v_new_total then
    raise exception 'INSUFFICIENT_AMOUNT_RECEIVED';
  end if;

  update orders
  set status = 'confirmed',
      confirmed_by_vendor = true,
      confirmed_at = now(),
      cash_amount_received = v_amount_received,
      total = v_new_total
  where id = p_order_id;

  if v_is_debt then
    update debts set amount = v_new_total where order_id = p_order_id and is_repaid = false;
  end if;

  return jsonb_build_object('order_id', p_order_id, 'new_total', v_new_total, 'amount_received', v_amount_received);
end;
$$;

-- Commandes à crédit : confirmées immédiatement à la création (voir
-- create_order_atomic), on renseigne aussi confirmed_at = created_at
-- pour celles déjà existantes afin que l'admin voie une heure cohérente.
update orders set confirmed_at = created_at where status = 'confirmed' and confirmed_at is null;
