-- ============================================================
-- migration_hardening_v3.sql
--
-- À exécuter APRÈS migration_hardening.sql (v2).
-- Corrige les 2 points critiques restants sur les fonctions
-- SECURITY DEFINER :
--
--   1) Aucune fonction n'était REVOKE : n'importe quel rôle
--      capable d'appeler du RPC Supabase (anon/authenticated)
--      pouvait en théorie les invoquer directement, en passant
--      n'importe quel p_client_id / p_vendor_id / p_debt_ids.
--      -> On révoque EXECUTE pour public/anon/authenticated.
--         Seul service_role (utilisé par ton backend Next.js)
--         garde le droit d'exécuter ces fonctions.
--
--   2) Aucune fonction ne fixait search_path : mauvaise
--      pratique standard pour du SECURITY DEFINER (risque de
--      détournement via un objet malveillant placé plus tôt
--      dans le search_path de l'appelant).
--      -> On verrouille search_path = pg_catalog, public sur
--         chacune, via ALTER FUNCTION (pas besoin de réécrire
--         le corps des fonctions).
--
-- En bonus (signalé en 🟠7 dans l'audit) :
--   3) create_order_atomic() ne vérifiait pas p.is_archived,
--      donc un produit archivé restait commandable tant que
--      son product_id était connu et qu'il restait du stock.
--      -> On recrée la fonction avec le filtre
--         "and p.is_archived = false" dans la sélection du
--         produit/stock.
--
-- Idempotent : peut être rejoué sans erreur (REVOKE / ALTER
-- FUNCTION / CREATE OR REPLACE FUNCTION supportent la ré-
-- exécution, contrairement aux ADD CONSTRAINT de la v2).
-- ============================================================


-- ------------------------------------------------------------
-- 1) REVOKE EXECUTE : ces fonctions ne doivent être appelables
--    que par ton backend (service_role), jamais depuis le
--    navigateur via anon/authenticated.
-- ------------------------------------------------------------

revoke execute on function create_order_atomic(uuid, uuid, jsonb, uuid, boolean, numeric)
  from public, anon, authenticated;

revoke execute on function cancel_pending_order_atomic(uuid)
  from public, anon, authenticated;

revoke execute on function confirm_vendor_order_atomic(uuid, uuid, jsonb, numeric)
  from public, anon, authenticated;

revoke execute on function reject_vendor_order_atomic(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function create_debt_repayment_atomic(uuid, uuid[], uuid)
  from public, anon, authenticated;

revoke execute on function confirm_debt_repayment_atomic(uuid, uuid, numeric)
  from public, anon, authenticated;

revoke execute on function reject_debt_repayment_atomic(uuid)
  from public, anon, authenticated;

revoke execute on function mark_debts_repaid_atomic(uuid, uuid[], numeric)
  from public, anon, authenticated;

-- NB : service_role contourne RLS/GRANT par défaut sur Supabase,
-- donc ton backend continuera de fonctionner sans changement.
-- Si un jour tu veux être explicite malgré tout :
-- grant execute on function create_order_atomic(uuid, uuid, jsonb, uuid, boolean, numeric) to service_role;
-- (idem pour les 7 autres) — optionnel, non nécessaire en pratique.


-- ------------------------------------------------------------
-- 2) Verrouille search_path sur toutes les fonctions
--    SECURITY DEFINER du projet.
-- ------------------------------------------------------------

alter function create_order_atomic(uuid, uuid, jsonb, uuid, boolean, numeric)
  set search_path = pg_catalog, public;

alter function cancel_pending_order_atomic(uuid)
  set search_path = pg_catalog, public;

alter function confirm_vendor_order_atomic(uuid, uuid, jsonb, numeric)
  set search_path = pg_catalog, public;

alter function reject_vendor_order_atomic(uuid, uuid)
  set search_path = pg_catalog, public;

alter function create_debt_repayment_atomic(uuid, uuid[], uuid)
  set search_path = pg_catalog, public;

alter function confirm_debt_repayment_atomic(uuid, uuid, numeric)
  set search_path = pg_catalog, public;

alter function reject_debt_repayment_atomic(uuid)
  set search_path = pg_catalog, public;

alter function mark_debts_repaid_atomic(uuid, uuid[], numeric)
  set search_path = pg_catalog, public;


-- ------------------------------------------------------------
-- 3) create_order_atomic() : exclut les produits archivés.
--    Corps identique à la version dans migration_hardening.sql,
--    seule la clause "and p.is_archived = false" est ajoutée
--    dans le SELECT vendor_stock/products.
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
set search_path = pg_catalog, public
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
  -- Ajout : and p.is_archived = false (produit retiré du catalogue
  -- = impossible à commander même si le product_id est connu).
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
    'api_key', v_api_key,
    'merchant_link', v_merchant_link
  );
end;
$$;

-- Le REVOKE + ALTER FUNCTION du bloc 1/2 ci-dessus s'appliquaient
-- à la définition précédente ; comme cette fonction est recréée
-- ici avec "set search_path" déjà inclus dans sa définition, on
-- réapplique le REVOKE pour être sûr qu'il n'a pas été remis à
-- zéro par le CREATE OR REPLACE (par précaution — sur Postgres
-- REPLACE conserve normalement les GRANT existants, mais mieux
-- vaut être explicite).
revoke execute on function create_order_atomic(uuid, uuid, jsonb, uuid, boolean, numeric)
  from public, anon, authenticated;
