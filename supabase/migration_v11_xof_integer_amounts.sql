-- ============================================================================
-- migration_v11_xof_integer_amounts.sql
-- ----------------------------------------------------------------------------
-- Corrige le point 🔴/🟠 de l'audit : le XOF n'a pas de décimales, mais tous
-- les montants étaient stockés en numeric(10,2). Wave arrondit ses montants
-- (Math.round côté lib/wave.ts), donc un total DB à virgule (ex: 100.40)
-- pouvait ne plus correspondre exactement au montant réellement payé sur
-- Wave (100), obligeant le webhook à comparer round(total) au montant Wave
-- plutôt qu'une égalité stricte -> risque d'incohérence financière.
--
-- Après cette migration, un montant en franc CFA ne PEUT plus être un
-- nombre à virgule : la colonne elle-même est un entier. Le webhook Wave
-- compare désormais total = wave_amount à l'identique, sans arrondi.
--
-- À exécuter APRÈS migration_v11_vendor_active_order.sql.
--
-- ⚠️ Migration avec ALTER COLUMN ... TYPE : à exécuter idéalement pendant
-- une fenêtre de maintenance courte. Elle arrondit les valeurs existantes
-- (round(...)::integer) ; si ta base ne contient déjà que des montants
-- ronds (ce qui est normalement le cas puisque le frontend n'a jamais
-- permis de saisir des centimes), aucune donnée n'est perdue. Fais une
-- sauvegarde avant si tu as un doute sur des données historiques.
--
-- Idempotent pour les ALTER COLUMN (le type cible est vérifié implicitement
-- par Postgres, qui les no-op si déjà integer) et pour les fonctions
-- (CREATE OR REPLACE / DROP FUNCTION IF EXISTS).
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Colonnes monétaires : numeric(10,2) -> integer
-- ------------------------------------------------------------
alter table products
  alter column price type integer using round(price)::integer;

alter table orders
  alter column total type integer using round(total)::integer,
  alter column cash_amount_received type integer using round(cash_amount_received)::integer;

alter table order_items
  alter column unit_price type integer using round(unit_price)::integer;

alter table debts
  alter column amount type integer using round(amount)::integer;

alter table debt_repayments
  alter column amount type integer using round(amount)::integer,
  alter column cash_amount_received type integer using round(cash_amount_received)::integer;

comment on column products.price is 'Prix en FCFA (XOF, entier — pas de décimales).';
comment on column orders.total is 'Total en FCFA (XOF, entier).';
comment on column order_items.unit_price is 'Prix unitaire en FCFA au moment de l''achat (XOF, entier).';
comment on column debts.amount is 'Montant de la dette en FCFA (XOF, entier).';
comment on column debt_repayments.amount is 'Montant du remboursement en FCFA (XOF, entier).';

-- ------------------------------------------------------------
-- 2. create_order_atomic() : p_debt_limit, prix, total en integer.
--    Signature modifiée (numeric -> integer) : on retire explicitement
--    l'ancienne surcharge pour ne pas laisser deux fonctions coexister.
-- ------------------------------------------------------------
drop function if exists create_order_atomic(uuid, uuid, jsonb, uuid, boolean, numeric, text);

create or replace function create_order_atomic(
  p_client_id uuid,
  p_vendor_id uuid,
  p_items jsonb,
  p_payment_method_id uuid,
  p_is_debt boolean,
  p_debt_limit integer,
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
  v_price integer;
  v_stock_id uuid;
  v_stock_qty int;
  v_total integer := 0;
  v_payment_type text;
  v_api_key text;
  v_merchant_link text;
  v_is_active boolean;
  v_order_id uuid;
  v_status text;
  v_current_debt integer;
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
  select v_order_id, (elem->>'product_id')::uuid, (elem->>'quantity')::int, (elem->>'unit_price')::integer
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

revoke execute on function create_order_atomic(uuid, uuid, jsonb, uuid, boolean, integer, text)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. confirm_vendor_order_atomic() : cash_amount_received en integer.
-- ------------------------------------------------------------
drop function if exists confirm_vendor_order_atomic(uuid, uuid, jsonb, numeric);

create or replace function confirm_vendor_order_atomic(
  p_order_id uuid,
  p_vendor_id uuid,
  p_items jsonb,
  p_cash_amount_received integer
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
  v_new_total integer := 0;
  v_amount_received integer;
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
      cash_amount_received = v_amount_received,
      total = v_new_total
  where id = p_order_id;

  if v_is_debt then
    update debts set amount = v_new_total where order_id = p_order_id and is_repaid = false;
  end if;

  return jsonb_build_object('order_id', p_order_id, 'new_total', v_new_total, 'amount_received', v_amount_received);
end;
$$;

revoke execute on function confirm_vendor_order_atomic(uuid, uuid, jsonb, integer)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. create_debt_repayment_atomic() : pas de changement de signature
--    (aucun paramètre monétaire), seule la variable interne v_amount
--    passe en integer (elle hérite du type de debts.amount, déjà
--    modifié plus haut, mais on la déclare explicitement pour clarté).
-- ------------------------------------------------------------
create or replace function create_debt_repayment_atomic(
  p_client_id uuid,
  p_debt_ids uuid[],
  p_payment_method_id uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_amount integer;
  v_count int;
  v_conflict_count int;
  v_repayment_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id::text));

  select count(*), coalesce(sum(amount), 0) into v_count, v_amount
  from debts
  where id = any(p_debt_ids) and client_id = p_client_id and is_repaid = false;

  if v_count <> array_length(p_debt_ids, 1) then
    raise exception 'INVALID_DEBT_SELECTION';
  end if;

  select count(*) into v_conflict_count
  from debt_repayments
  where status = 'pending' and debt_ids && p_debt_ids;

  if v_conflict_count > 0 then
    raise exception 'REPAYMENT_ALREADY_PENDING';
  end if;

  insert into debt_repayments (client_id, debt_ids, amount, payment_method_id, status)
  values (p_client_id, p_debt_ids, v_amount, p_payment_method_id, 'pending')
  returning id into v_repayment_id;

  return jsonb_build_object('repayment_id', v_repayment_id, 'amount', v_amount);
end;
$$;

-- ------------------------------------------------------------
-- 5. confirm_debt_repayment_atomic() : cash_amount_received en integer.
-- ------------------------------------------------------------
drop function if exists confirm_debt_repayment_atomic(uuid, uuid, numeric);

create or replace function confirm_debt_repayment_atomic(
  p_repayment_id uuid,
  p_vendor_id uuid,
  p_cash_amount_received integer
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_status text;
  v_amount integer;
  v_debt_ids uuid[];
  v_received integer;
begin
  select status, amount, debt_ids into v_status, v_amount, v_debt_ids
  from debt_repayments where id = p_repayment_id for update;

  if v_status is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_status <> 'pending' then
    raise exception 'ALREADY_PROCESSED';
  end if;

  v_received := coalesce(p_cash_amount_received, v_amount);
  if v_received < v_amount then
    raise exception 'INSUFFICIENT_AMOUNT_RECEIVED';
  end if;

  update debts set is_repaid = true, repaid_at = now() where id = any(v_debt_ids);

  update debt_repayments
  set status = 'confirmed', confirmed_by_vendor_id = p_vendor_id,
      cash_amount_received = v_received, confirmed_at = now()
  where id = p_repayment_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function confirm_debt_repayment_atomic(uuid, uuid, integer)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 6. mark_debts_repaid_atomic() : cash_amount_received en integer.
-- ------------------------------------------------------------
drop function if exists mark_debts_repaid_atomic(uuid, uuid[], numeric);

create or replace function mark_debts_repaid_atomic(
  p_client_id uuid,
  p_debt_ids uuid[],
  p_cash_amount_received integer
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_expected_total integer;
  v_count int;
  v_received integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id::text));

  select count(*), coalesce(sum(amount), 0) into v_count, v_expected_total
  from debts
  where id = any(p_debt_ids) and client_id = p_client_id and is_repaid = false
  for update;

  if v_count <> array_length(p_debt_ids, 1) then
    raise exception 'INVALID_DEBT_SELECTION';
  end if;

  v_received := coalesce(p_cash_amount_received, v_expected_total);
  if v_received < v_expected_total then
    raise exception 'INSUFFICIENT_AMOUNT_RECEIVED';
  end if;

  update debts set is_repaid = true, repaid_at = now()
  where id = any(p_debt_ids);

  return jsonb_build_object('ok', true, 'amount', v_expected_total);
end;
$$;

revoke execute on function mark_debts_repaid_atomic(uuid, uuid[], integer)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 7. process_wave_webhook_atomic() : p_wave_amount en integer, et
--    comparaison STRICTE (v_total = p_wave_amount) au lieu de
--    round(v_total) <> p_wave_amount. C'est tout l'objet de cette
--    migration : total est maintenant TOUJOURS un entier, donc la
--    comparaison n'a plus besoin d'arrondir, elle exige une égalité
--    exacte — plus aucune marge d'erreur possible entre le montant
--    dû et le montant réellement payé sur Wave.
-- ------------------------------------------------------------
drop function if exists process_wave_webhook_atomic(text, text, uuid, boolean, boolean, numeric, text, text, text);

create or replace function process_wave_webhook_atomic(
  p_event_id text,
  p_event_type text,
  p_order_id uuid,
  p_payment_succeeded boolean,
  p_payment_failed boolean,
  p_wave_amount integer,         -- montant annoncé par Wave ; NULL si absent ou non entier
  p_wave_currency text,
  p_wave_checkout_id text,
  p_wave_transaction_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_vendor_id uuid;
  v_total integer;
  v_wave_checkout_id_db text;
  v_item record;
begin
  insert into wave_webhook_events (id, type)
  values (p_event_id, p_event_type)
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select status, vendor_id, total, wave_checkout_id
    into v_status, v_vendor_id, v_total, v_wave_checkout_id_db
  from orders
  where id = p_order_id
  for update;

  if v_status is null then
    return jsonb_build_object('ok', true, 'ignored', 'order_not_found');
  end if;

  if v_status <> 'pending' then
    return jsonb_build_object('ok', true, 'already_processed', true);
  end if;

  if p_payment_succeeded then
    -- total est désormais toujours un entier : comparaison stricte,
    -- sans round(), aucun montant approximatif n'est plus accepté.
    if p_wave_amount is null
       or p_wave_currency is distinct from 'XOF'
       or p_wave_checkout_id is null
       or v_wave_checkout_id_db is null
       or p_wave_checkout_id <> v_wave_checkout_id_db
       or v_total <> p_wave_amount
    then
      return jsonb_build_object('ok', true, 'ignored', 'mismatch');
    end if;

    update orders
    set status = 'confirmed',
        wave_transaction_id = p_wave_transaction_id,
        wave_checkout_id = p_wave_checkout_id
    where id = p_order_id;

    return jsonb_build_object('ok', true, 'confirmed', true);

  elsif p_payment_failed then
    for v_item in
      select product_id, quantity from order_items where order_id = p_order_id
    loop
      update vendor_stock set quantity = quantity + v_item.quantity, updated_at = now()
      where vendor_id = v_vendor_id and product_id = v_item.product_id;
    end loop;

    update orders set status = 'cancelled' where id = p_order_id;

    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;

  return jsonb_build_object('ok', true, 'ignored', 'unhandled_event_type');
end;
$$;

revoke execute on function process_wave_webhook_atomic(
  text, text, uuid, boolean, boolean, integer, text, text, text
) from public, anon, authenticated;
