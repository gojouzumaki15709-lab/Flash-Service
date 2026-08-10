-- ============================================================
-- MIGRATION DE DURCISSEMENT - à exécuter dans Supabase SQL Editor
-- Corrige : validations manquantes, races conditions sur le stock,
-- la dette, les confirmations vendeur et les remboursements.
-- Toute la logique sensible passe désormais par des fonctions
-- PostgreSQL transactionnelles (SECURITY DEFINER) plutôt que par
-- des suites SELECT/UPDATE faites depuis le code Next.js.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CONTRAINTES D'INTÉGRITÉ (filet de sécurité au niveau DB,
--    même si l'API laisse passer une valeur incorrecte)
-- ------------------------------------------------------------
alter table vendor_stock
  add constraint vendor_stock_quantity_nonneg check (quantity >= 0);

alter table products
  add constraint products_price_nonneg check (price >= 0),
  add constraint products_threshold_nonneg check (low_stock_threshold >= 0),
  add constraint products_name_nonempty check (length(trim(name)) > 0);

alter table order_items
  add constraint order_items_quantity_pos check (quantity > 0),
  add constraint order_items_quantity_taken_range
    check (quantity_taken is null or (quantity_taken >= 0 and quantity_taken <= quantity)),
  add constraint order_items_unit_price_nonneg check (unit_price >= 0);

alter table orders
  add constraint orders_total_nonneg check (total >= 0),
  add constraint orders_status_valid check (status in ('pending', 'confirmed', 'cancelled')),
  add constraint orders_cash_amount_nonneg
    check (cash_amount_received is null or cash_amount_received >= 0);

alter table debts
  add constraint debts_amount_nonneg check (amount >= 0);

alter table debt_repayments
  add constraint debt_repayments_amount_nonneg check (amount >= 0),
  add constraint debt_repayments_status_valid check (status in ('pending', 'confirmed', 'cancelled')),
  add constraint debt_repayments_cash_amount_nonneg
    check (cash_amount_received is null or cash_amount_received >= 0);

-- updated_at sur orders : utile pour savoir quand une commande a réellement
-- été confirmée/annulée (aujourd'hui seul created_at existe).
alter table orders add column if not exists updated_at timestamptz not null default now();

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- 2. CRÉATION DE COMMANDE ATOMIQUE
--    Remplace toute la logique JS de app/api/orders/route.ts :
--    - verrouille le vendeur + les lignes de stock concernées
--    - vérifie stock suffisant, ligne par ligne, sous verrou
--    - vérifie le plafond de dette sous verrou consultatif
--      (empêche deux commandes simultanées de dépasser 1000 FCFA)
--    - refuse toute combinaison dette + moyen de paiement
--    - décide le statut serveur (jamais confirmé sans preuve de paiement)
--    Tout se passe dans une seule transaction : soit tout réussit,
--    soit rien n'est appliqué.
-- ------------------------------------------------------------
create or replace function create_order_atomic(
  p_client_id uuid,
  p_vendor_id uuid,
  p_items jsonb,              -- [{"product_id":"...","quantity":n}, ...]
  p_payment_method_id uuid,   -- null si dette
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

  -- Verrouille la ligne du vendeur pour toute la durée de la transaction.
  select is_open into v_vendor_open from vendors where id = p_vendor_id for update;
  if v_vendor_open is distinct from true then
    raise exception 'VENDOR_CLOSED';
  end if;

  -- Charge et verrouille le moyen de paiement choisi (s'il y en a un).
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

  -- Détermination STRICTE du statut, côté serveur uniquement.
  -- Aucun statut "confirmed" n'est jamais accordé sans un chemin de
  -- paiement reconnu (dette validée sous plafond, ou vérification
  -- ultérieure par vendeur/webhook Wave).
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
    -- Avant : un paiementMethodId absent/inconnu ou un type "autre"
    -- tombait silencieusement en "confirmed". Fini : on refuse.
    raise exception 'UNSUPPORTED_PAYMENT_METHOD';
  end if;

  if p_payment_method_id is null and v_merchant_link is null then
    v_merchant_link := null; -- no-op, juste pour lisibilité
  end if;

  -- Vérifie et réserve le stock ligne par ligne, sous verrou.
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

  -- Plafond de dette vérifié sous verrou consultatif par client :
  -- deux commandes à crédit simultanées du même client ne peuvent
  -- plus dépasser ensemble le plafond.
  if p_is_debt then
    perform pg_advisory_xact_lock(hashtext(p_client_id::text));
    select coalesce(sum(amount), 0) into v_current_debt
    from debts where client_id = p_client_id and is_repaid = false;

    if v_current_debt + v_total > p_debt_limit then
      raise exception 'DEBT_LIMIT_EXCEEDED';
    end if;
  end if;

  insert into orders (client_id, vendor_id, payment_method_id, is_debt, total, status)
  values (p_client_id, p_vendor_id, p_payment_method_id, p_is_debt, v_total, v_status)
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
    'api_key', v_api_key,          -- lu uniquement côté serveur (route API), jamais renvoyé au client
    'merchant_link', v_merchant_link
  );
end;
$$;

-- ------------------------------------------------------------
-- 3. ANNULATION ATOMIQUE D'UNE COMMANDE EN ATTENTE
--    Restitue tout le stock réservé. Utilisée pour :
--    - le rollback si la création de session Wave échoue
--    - le rejet d'une commande par le vendeur
--    - un paiement Wave qui échoue (webhook payment_failed)
-- ------------------------------------------------------------
create or replace function cancel_pending_order_atomic(p_order_id uuid) returns void
language plpgsql
security definer
as $$
declare
  v_status text;
  v_vendor_id uuid;
  v_item record;
begin
  select status, vendor_id into v_status, v_vendor_id from orders where id = p_order_id for update;
  if v_status is null or v_status <> 'pending' then
    return; -- déjà traitée, idempotent
  end if;

  for v_item in
    select product_id, quantity from order_items where order_id = p_order_id
  loop
    update vendor_stock set quantity = quantity + v_item.quantity, updated_at = now()
    where vendor_id = v_vendor_id and product_id = v_item.product_id;
  end loop;

  update orders set status = 'cancelled' where id = p_order_id;
end;
$$;

-- ------------------------------------------------------------
-- 4. CONFIRMATION VENDEUR ATOMIQUE
--    Remplace la logique de app/api/vendor/orders PATCH :
--    - verrouille la commande (empêche double confirmation concurrente)
--    - refuse de confirmer manuellement une commande Wave en mode API
--      (elle ne doit être confirmée QUE par le webhook Wave)
--    - restitue au stock la différence commandé/réellement remis
--    - EXIGE que la somme reçue en liquide couvre le nouveau total
--    - recalcule la dette si jamais elle était liée à cette commande
-- ------------------------------------------------------------
create or replace function confirm_vendor_order_atomic(
  p_order_id uuid,
  p_vendor_id uuid,
  p_items jsonb,              -- [{"order_item_id":"...","quantity":n}, ...] (optionnel par ligne)
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
    -- Un paiement Wave en mode API ne peut être confirmé que par le
    -- webhook Wave (paiement réellement vérifié), jamais manuellement.
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

  -- Si une dette avait été créée pour cette commande (cas normalement
  -- impossible aujourd'hui car les commandes à crédit sont confirmées
  -- immédiatement, mais gardé par sécurité), on la recale sur le
  -- montant réellement livré plutôt que le montant initialement commandé.
  if v_is_debt then
    update debts set amount = v_new_total where order_id = p_order_id and is_repaid = false;
  end if;

  return jsonb_build_object('order_id', p_order_id, 'new_total', v_new_total, 'amount_received', v_amount_received);
end;
$$;

-- ------------------------------------------------------------
-- 5. REJET D'UNE COMMANDE PAR LE VENDEUR (avec vérification de
--    propriété, contrairement à cancel_pending_order_atomic)
-- ------------------------------------------------------------
create or replace function reject_vendor_order_atomic(p_order_id uuid, p_vendor_id uuid) returns void
language plpgsql
security definer
as $$
declare
  v_status text;
  v_order_vendor_id uuid;
begin
  select status, vendor_id into v_status, v_order_vendor_id from orders where id = p_order_id for update;
  if v_order_vendor_id is null or v_order_vendor_id <> p_vendor_id then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_status <> 'pending' then
    raise exception 'ORDER_NOT_PENDING';
  end if;

  perform cancel_pending_order_atomic(p_order_id);
end;
$$;

-- ------------------------------------------------------------
-- 6. CRÉATION DE DEMANDE DE REMBOURSEMENT ATOMIQUE
--    Empêche deux demandes concurrentes de couvrir les mêmes dettes.
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
  v_amount numeric;
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
-- 7. CONFIRMATION / REJET ATOMIQUE D'UN REMBOURSEMENT
--    Empêche deux vendeurs de confirmer la même demande en même temps.
-- ------------------------------------------------------------
create or replace function confirm_debt_repayment_atomic(
  p_repayment_id uuid,
  p_vendor_id uuid,
  p_cash_amount_received numeric
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_status text;
  v_amount numeric;
  v_debt_ids uuid[];
  v_received numeric;
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

create or replace function reject_debt_repayment_atomic(p_repayment_id uuid) returns void
language plpgsql
security definer
as $$
declare
  v_status text;
begin
  select status into v_status from debt_repayments where id = p_repayment_id for update;
  if v_status is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_status <> 'pending' then
    raise exception 'ALREADY_PROCESSED';
  end if;
  update debt_repayments set status = 'cancelled' where id = p_repayment_id;
end;
$$;

-- ------------------------------------------------------------
-- 8. REMBOURSEMENT "EN PERSONNE" ATOMIQUE (vendeur solde directement
--    les dettes d'un client trouvé par téléphone)
-- ------------------------------------------------------------
create or replace function mark_debts_repaid_atomic(
  p_client_id uuid,
  p_debt_ids uuid[],
  p_cash_amount_received numeric
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_expected_total numeric;
  v_count int;
  v_received numeric;
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

-- ------------------------------------------------------------
-- Notes de déploiement
-- ------------------------------------------------------------
-- Ces fonctions sont SECURITY DEFINER : elles s'exécutent avec les
-- droits du propriétaire (généralement le rôle postgres/service),
-- ce qui leur permet d'agir même avec RLS activé sans policy. Comme
-- pour le reste du projet, c'est le serveur Next.js (clé service_role)
-- qui les appelle via .rpc(...) — jamais le navigateur directement.
--
-- Avant d'exécuter ce fichier sur une base existante, vérifie que
-- les données actuelles respectent déjà les contraintes ajoutées à
-- l'étape 1 (ex : aucune quantity négative en base), sinon les
-- "alter table ... add constraint" échoueront. En cas d'échec,
-- corrige d'abord les données concernées puis relance.
