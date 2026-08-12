-- ============================================================================
-- migration_v12_flash_points.sql
--
-- Ajoute :
--   1. Le système de points "Flash-points" (fidélité par activité continue).
--   2. Le crédit client ("Flash-points" >= 100) avec plafonds de dette.
--   3. Le "Flash day" (promo bi-hebdomadaire) + notification admin en chef.
--   4. La hiérarchie admin (un admin en chef, seul à voir/supprimer les autres).
--
-- À exécuter APRÈS toutes les migrations existantes (schema.sql + migrations
-- déjà en place dans ce dossier). Idempotent : rejouable sans erreur.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. FLASH-POINTS : colonnes sur clients
-- ----------------------------------------------------------------------------
-- flash_unlocked : passe à true dès que le client a réalisé au moins une
--   fois une série de 3 jours calendaires consécutifs avec >= 1 commande
--   confirmée chacun. Une fois true, reste true pour toujours (pas besoin
--   de refaire la série). Tant que c'est false, la fonctionnalité Flash-points
--   est invisible pour le client (aucune indication de progression).
-- flash_points : nombre de Flash-points actuels du client.
alter table clients add column if not exists flash_unlocked boolean not null default false;
alter table clients add column if not exists flash_points integer not null default 0;
alter table clients add column if not exists flash_points_peak integer not null default 0; -- plus haut total jamais atteint (sert au calcul du plafond de dette une fois redescendu sous 100)

-- Historique des points gagnés (sert au calcul du top 3 mensuel et à l'audit).
create table if not exists flash_point_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,
  points integer not null,        -- positif (gain) ou négatif (dépense pour un crédit)
  reason text not null,           -- 'order' | 'unlock' | 'credit_spent'
  created_at timestamptz not null default now()
);
alter table flash_point_events enable row level security;
create index if not exists idx_flash_point_events_client_date on flash_point_events(client_id, created_at);

-- ----------------------------------------------------------------------------
-- 2. FONCTION : attribution des Flash-points après confirmation d'une commande
-- ----------------------------------------------------------------------------
-- Règles (voir échanges avec le porteur du projet) :
--  - Tant que flash_unlocked = false : on vérifie si le client a désormais
--    3 jours calendaires CONSÉCUTIFS avec >= 1 commande confirmée chacun.
--    Si oui -> flash_unlocked = true, mais AUCUN point n'est donné pour les
--    commandes de cette série (elles ne servent qu'à débloquer). Si la série
--    n'est pas (encore) accomplie, rien ne se passe et le site fonctionne
--    normalement (aucune trace visible pour le client).
--  - Une fois flash_unlocked = true (définitivement) : CHAQUE commande
--    confirmée suivante (y compris les achats à crédit) rapporte +1 Flash-point.
create or replace function award_flash_points_for_confirmed_order(
  p_client_id uuid,
  p_order_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_unlocked boolean;
  v_has_streak boolean;
  v_new_points integer;
begin
  select flash_unlocked into v_unlocked from clients where id = p_client_id for update;

  if v_unlocked then
    update clients
      set flash_points = flash_points + 1,
          flash_points_peak = greatest(flash_points_peak, flash_points + 1)
      where id = p_client_id
      returning flash_points into v_new_points;
    insert into flash_point_events (client_id, order_id, points, reason)
      values (p_client_id, p_order_id, 1, 'order');
    return;
  end if;

  -- Recherche d'une série d'au moins 3 jours calendaires consécutifs avec
  -- au moins une commande confirmée chacun (technique "gaps and islands" :
  -- regrouper les dates dont (date - numéro de rang) est constant = dates
  -- consécutives).
  select exists (
    select 1
    from (
      select d, d - (row_number() over (order by d))::int as grp
      from (
        select distinct (created_at at time zone 'utc')::date as d
        from orders
        where client_id = p_client_id and status = 'confirmed'
      ) days
    ) grouped
    group by grp
    having count(*) >= 3
  ) into v_has_streak;

  if v_has_streak then
    update clients set flash_unlocked = true where id = p_client_id;
    insert into flash_point_events (client_id, order_id, points, reason)
      values (p_client_id, p_order_id, 0, 'unlock');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Brancher l'attribution des points sur la confirmation d'une commande
--    normale (vendeur) : on garde confirm_vendor_order_atomic telle que
--    définie par la dernière migration en date, en ajoutant uniquement
--    l'appel à award_flash_points_for_confirmed_order() à la fin, ainsi que
--    confirmed_at = now() (déjà utilisé par l'admin, voir
--    migration_order_confirmed_at.sql, mais absent de la version qui a
--    retiré l'ancien système de dette).
-- ----------------------------------------------------------------------------
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
  v_client_id uuid;
  v_payment_type text;
  v_api_key text;
  v_item record;
  v_final_qty int;
  v_diff int;
  v_new_total integer := 0;
  v_amount_received integer;
begin
  select o.status, o.vendor_id, o.client_id, pm.type, pm.api_key_encrypted
    into v_status, v_order_vendor_id, v_client_id, v_payment_type, v_api_key
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

  perform award_flash_points_for_confirmed_order(v_client_id, p_order_id);

  return jsonb_build_object('order_id', p_order_id, 'new_total', v_new_total, 'amount_received', v_amount_received);
end;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_vendor_order_atomic(uuid, uuid, jsonb, integer)
FROM public, anon, authenticated;

-- Ajoute confirmed_at = now() lors de la confirmation, si la colonne n'existe pas déjà.
alter table orders add column if not exists confirmed_at timestamptz;

-- ----------------------------------------------------------------------------
-- 4. CRÉDIT (achat à crédit financé par les Flash-points)
-- ----------------------------------------------------------------------------
-- Règles :
--  - Débloqué à partir de 100 Flash-points (première fois).
--  - Chaque prêt (achat à crédit) coûte 10 Flash-points.
--  - Une fois le crédit débloqué (le client a déjà atteint 100 un jour),
--    il peut continuer à emprunter tant que son solde ne descend pas sous 20.
--  - En dessous de 20 (ou s'il n'a jamais atteint 100), aucun crédit.
--  - Plafond de dette CUMULÉE (tous prêts non remboursés confondus), calculé
--    sur le solde de points au moment de la demande :
--      * 20 à 100 points (uniquement si déjà atteint 100 par le passé) : 1000
--      * 101 à 150 : 1500
--      * 151+ : 2000
--  - Le remboursement est confirmé soit par le vendeur (cash), soit
--    directement sur le site (Wave) — voir confirm_flash_credit_repayment_atomic
--    et le webhook Wave.
create table if not exists flash_credits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  vendor_id uuid not null references vendors(id),
  order_id uuid not null references orders(id),
  amount integer not null,                 -- FCFA, montant emprunté
  points_spent integer not null default 10,
  points_at_request integer not null,      -- solde de points au moment du prêt (pour audit du plafond appliqué)
  status text not null default 'pending_repayment', -- pending_repayment | repayment_pending_confirmation | repaid | cancelled
  payment_method_id uuid references payment_methods(id), -- renseigné si remboursement Wave en cours
  wave_checkout_id text,
  cash_amount_received integer,
  confirmed_by_vendor_id uuid references vendors(id),
  created_at timestamptz not null default now(),
  repaid_at timestamptz
);
alter table flash_credits enable row level security;
create index if not exists idx_flash_credits_client on flash_credits(client_id);
create index if not exists idx_flash_credits_status on flash_credits(status);

-- Plafond de dette applicable pour un client selon son solde ACTUEL de points
-- et son historique (flash_points_peak >= 100 = a déjà débloqué le crédit).
create or replace function flash_credit_limit_for_points(p_points integer, p_peak integer)
returns integer
language sql
immutable
as $$
  select case
    when p_peak < 100 then 0
    when p_points < 20 then 0
    when p_points <= 100 then 1000
    when p_points <= 150 then 1500
    else 2000
  end;
$$;

-- Crée un achat à crédit : commande confirmée immédiatement (pas de paiement
-- au moment de l'achat), débite 10 Flash-points, vérifie le plafond de dette
-- cumulée (somme des flash_credits non remboursés) sur la base du solde de
-- points au moment de la demande.
create or replace function request_flash_credit_atomic(
  p_client_id uuid,
  p_vendor_id uuid,
  p_items jsonb,
  p_client_room text
) returns jsonb
language plpgsql
security definer
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
  v_order_id uuid;
  v_order_items jsonb := '[]'::jsonb;
  v_client_room text;
  v_points integer;
  v_peak integer;
  v_limit integer;
  v_current_debt integer;
  v_credit_id uuid;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  v_client_room := nullif(trim(p_client_room), '');
  if v_client_room is null then
    raise exception 'CLIENT_ROOM_REQUIRED';
  end if;

  -- Verrouille le client pour éviter deux prêts simultanés qui dépasseraient
  -- ensemble le plafond (race condition classique sur un solde partagé).
  select flash_points, flash_points_peak into v_points, v_peak
  from clients where id = p_client_id for update;

  if v_points < 10 then
    raise exception 'INSUFFICIENT_FLASH_POINTS';
  end if;

  v_limit := flash_credit_limit_for_points(v_points, v_peak);
  if v_limit <= 0 then
    raise exception 'CREDIT_NOT_UNLOCKED';
  end if;

  select coalesce(sum(amount), 0) into v_current_debt
  from flash_credits
  where client_id = p_client_id and status in ('pending_repayment', 'repayment_pending_confirmation');

  select is_open, is_active into v_vendor_open, v_vendor_active
  from vendors where id = p_vendor_id for update;

  if v_vendor_active is distinct from true then
    raise exception 'VENDOR_INACTIVE';
  end if;
  if v_vendor_open is distinct from true then
    raise exception 'VENDOR_CLOSED';
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
    where vs.vendor_id = p_vendor_id and vs.product_id = v_product_id and p.is_archived = false
    for update of vs;

    if v_stock_id is null or v_stock_qty < v_qty then
      raise exception 'INSUFFICIENT_STOCK:%', v_product_id;
    end if;

    update vendor_stock set quantity = quantity - v_qty, updated_at = now() where id = v_stock_id;

    v_total := v_total + v_price * v_qty;
    v_order_items := v_order_items || jsonb_build_object(
      'product_id', v_product_id, 'quantity', v_qty, 'unit_price', v_price
    );
  end loop;

  if v_current_debt + v_total > v_limit then
    raise exception 'DEBT_LIMIT_EXCEEDED';
  end if;

  insert into orders (client_id, vendor_id, total, status, client_room, confirmed_at, confirmed_by_vendor)
  values (p_client_id, p_vendor_id, v_total, 'confirmed', v_client_room, now(), true)
  returning id into v_order_id;

  insert into order_items (order_id, product_id, quantity, unit_price, quantity_taken)
  select v_order_id, (elem->>'product_id')::uuid, (elem->>'quantity')::int, (elem->>'unit_price')::integer,
         (elem->>'quantity')::int
  from jsonb_array_elements(v_order_items) elem;

  update clients set flash_points = flash_points - 10 where id = p_client_id;
  insert into flash_point_events (client_id, order_id, points, reason)
    values (p_client_id, v_order_id, -10, 'credit_spent');

  insert into flash_credits (client_id, vendor_id, order_id, amount, points_spent, points_at_request)
  values (p_client_id, p_vendor_id, v_order_id, v_total, 10, v_points)
  returning id into v_credit_id;

  -- La commande à crédit compte aussi comme une commande confirmée pour la
  -- progression Flash-points future (série de 3 jours / +1 point si déjà débloqué).
  perform award_flash_points_for_confirmed_order(p_client_id, v_order_id);

  return jsonb_build_object('order_id', v_order_id, 'credit_id', v_credit_id, 'total', v_total);
end;
$$;

REVOKE EXECUTE ON FUNCTION public.request_flash_credit_atomic(uuid, uuid, jsonb, text)
FROM public, anon, authenticated;

-- Le VENDEUR confirme avoir reçu le remboursement en liquide directement.
create or replace function confirm_flash_credit_cash_repayment_atomic(
  p_credit_id uuid,
  p_vendor_id uuid,
  p_cash_amount_received integer
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_status text;
  v_amount integer;
begin
  select status, amount into v_status, v_amount
  from flash_credits where id = p_credit_id for update;

  if v_status is null then
    raise exception 'CREDIT_NOT_FOUND';
  end if;
  if v_status not in ('pending_repayment', 'repayment_pending_confirmation') then
    raise exception 'CREDIT_NOT_REPAYABLE';
  end if;
  if p_cash_amount_received is null or p_cash_amount_received < v_amount then
    raise exception 'INSUFFICIENT_AMOUNT_RECEIVED';
  end if;

  update flash_credits
  set status = 'repaid',
      confirmed_by_vendor_id = p_vendor_id,
      cash_amount_received = p_cash_amount_received,
      repaid_at = now()
  where id = p_credit_id;

  return jsonb_build_object('credit_id', p_credit_id, 'status', 'repaid');
end;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_flash_credit_cash_repayment_atomic(uuid, uuid, integer)
FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. FLASH DAY (promo bi-hebdomadaire, 2 produits à -50%, choisis par
--    l'admin en chef, qui est notifié la veille)
-- ----------------------------------------------------------------------------
create table if not exists flash_days (
  id uuid primary key default gen_random_uuid(),
  scheduled_date date not null unique,
  product_id_1 uuid not null references products(id),
  product_id_2 uuid not null references products(id),
  discount_percent int not null default 50,
  notified_chief boolean not null default false,
  created_by uuid references admins(id),
  created_at timestamptz not null default now(),
  check (product_id_1 <> product_id_2)
);
alter table flash_days enable row level security;
create index if not exists idx_flash_days_date on flash_days(scheduled_date);

-- ----------------------------------------------------------------------------
-- 6. HIÉRARCHIE ADMIN : un admin en chef
-- ----------------------------------------------------------------------------
alter table admins add column if not exists is_chief boolean not null default false;
-- Un seul admin en chef à la fois : appliqué au niveau applicatif (route API)
-- plutôt qu'en contrainte SQL stricte, pour permettre une transition en
-- douceur (désigner un nouveau chef) sans verrouiller la base.

COMMIT;

-- ============================================================================
-- FIN migration_v12_flash_points.sql
-- ============================================================================
