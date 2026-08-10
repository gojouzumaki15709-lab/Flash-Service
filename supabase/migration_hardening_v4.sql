-- ============================================================
-- migration_hardening_v4.sql
--
-- À exécuter APRÈS migration_hardening_v3.sql.
--
-- Corrige le point 🔴12 de l'audit (webhook Wave pas atomique) et
-- resserre les points 🟠13/14/15 (checkout_id, devise, montant).
--
-- Avant : la route /api/webhooks/wave faisait, en JS, plusieurs
-- opérations séparées (insert wave_webhook_events, puis update
-- orders OU rpc cancel_pending_order_atomic). Si la 2e opération
-- échouait après que la 1re ait réussi, l'événement était marqué
-- "déjà traité" (idempotence) mais son effet métier (confirmer ou
-- annuler la commande) n'avait jamais eu lieu -> commande bloquée
-- silencieusement, stock jamais restitué.
--
-- Après : tout (insertion idempotente de l'événement + verrou de
-- la commande + vérifications + effet métier) se passe dans UNE
-- transaction PostgreSQL. Soit tout est appliqué, soit rien ne
-- l'est et Wave peut retenter l'appel webhook normalement.
--
-- Idempotent : peut être rejoué (CREATE OR REPLACE FUNCTION / REVOKE
-- supportent la ré-exécution).
-- ============================================================

create or replace function process_wave_webhook_atomic(
  p_event_id text,
  p_event_type text,
  p_order_id uuid,
  p_payment_succeeded boolean,   -- true si checkout.session.completed + payment_status = succeeded
  p_payment_failed boolean,      -- true si checkout.session.payment_failed
  p_wave_amount numeric,         -- montant annoncé par Wave ; NULL si absent OU non entier
                                  -- (le rejet des montants non entiers se décide côté route, voir
                                  -- app/api/webhooks/wave/route.ts : on ne passe jamais Math.round(...)
                                  -- ici, un montant à virgule doit être traité comme absent)
  p_wave_currency text,          -- valeur brute de event.data.currency, sans défaut
  p_wave_checkout_id text,       -- valeur brute de event.data.id
  p_wave_transaction_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_vendor_id uuid;
  v_total numeric;
  v_wave_checkout_id_db text;
  v_item record;
begin
  -- Idempotence : dans la même transaction que le traitement métier
  -- ci-dessous. "on conflict do nothing" + "if not found" détecte un
  -- événement déjà vu sans lever d'erreur.
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
    -- Commande introuvable : on ne fait rien de plus, l'événement
    -- reste enregistré (idempotence) mais aucun effet métier.
    return jsonb_build_object('ok', true, 'ignored', 'order_not_found');
  end if;

  if v_status <> 'pending' then
    -- Déjà confirmée/annulée par un événement précédent.
    return jsonb_build_object('ok', true, 'already_processed', true);
  end if;

  if p_payment_succeeded then
    -- Vérifications STRICTES (durcissement des points 13/14/15 de
    -- l'audit) : le checkout_id ET la devise DOIVENT être présents
    -- et correspondre exactement ; un montant absent ou non entier
    -- (filtré en amont côté route) est traité comme un mismatch.
    if p_wave_amount is null
       or p_wave_currency is distinct from 'XOF'
       or p_wave_checkout_id is null
       or v_wave_checkout_id_db is null
       or p_wave_checkout_id <> v_wave_checkout_id_db
       or round(v_total) <> p_wave_amount
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
    -- Même logique que cancel_pending_order_atomic, mais dans la
    -- même transaction que l'insertion de l'événement idempotent.
    for v_item in
      select product_id, quantity from order_items where order_id = p_order_id
    loop
      update vendor_stock set quantity = quantity + v_item.quantity, updated_at = now()
      where vendor_id = v_vendor_id and product_id = v_item.product_id;
    end loop;

    update orders set status = 'cancelled' where id = p_order_id;

    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;

  -- Type d'événement Wave qu'on ne traite pas (ex: session expirée) :
  -- l'événement reste enregistré pour l'idempotence, sans effet métier.
  return jsonb_build_object('ok', true, 'ignored', 'unhandled_event_type');
end;
$$;

-- Même politique que les autres fonctions SECURITY DEFINER du projet :
-- seul service_role (ton backend Next.js) peut l'appeler.
revoke execute on function process_wave_webhook_atomic(
  text, text, uuid, boolean, boolean, numeric, text, text, text
) from public, anon, authenticated;
