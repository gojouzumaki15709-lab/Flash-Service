-- ============================================================
-- MIGRATION : intégration Wave
-- À exécuter dans Supabase : Project > SQL Editor > New query
-- Sans danger sur une base existante (IF NOT EXISTS partout).
-- ============================================================

-- Colonnes sur "orders" pour suivre la session de paiement Wave
alter table orders add column if not exists wave_checkout_id text;
alter table orders add column if not exists wave_transaction_id text;

-- Index pour retrouver rapidement une commande à partir du client_reference
-- renvoyé par Wave dans le webhook (on y met l'id de la commande).
create index if not exists idx_orders_wave_checkout_id on orders(wave_checkout_id);

-- Table pour l'idempotence des webhooks Wave (un même événement peut être
-- envoyé plusieurs fois par Wave ; on ne doit le traiter qu'une fois).
create table if not exists wave_webhook_events (
  id text primary key,           -- l'id d'événement Wave (ex: EV_QvEZuDSQbLdI)
  type text not null,
  received_at timestamptz not null default now()
);
alter table wave_webhook_events enable row level security;
