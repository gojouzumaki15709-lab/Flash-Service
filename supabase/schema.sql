-- ============================================================
-- SCHEMA COMPLET - Application de vente de sucreries
-- A exécuter dans Supabase : Project > SQL Editor > New query
-- ============================================================

-- Extension pour générer des UUID
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. BÂTIMENTS (liste fixe : lettre A-Z + numéro 1-16)
-- ------------------------------------------------------------
create table buildings (
  id uuid primary key default gen_random_uuid(),
  letter char(1) not null,      -- A à Z
  number int not null,          -- 1 à 16
  created_at timestamptz not null default now(),
  unique (letter, number)
);

-- ------------------------------------------------------------
-- 2. ADMINISTRATEURS
-- ------------------------------------------------------------
create table admins (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,          -- identifiant de connexion
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. VENDEURS (créés/supprimés uniquement par un admin)
-- ------------------------------------------------------------
create table vendors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,          -- identifiant de connexion
  name text not null,
  password_hash text not null,
  building_id uuid not null references buildings(id),
  is_open boolean not null default false,   -- ouvert = connecté / en service
  created_by uuid references admins(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. CLIENTS (identifiant = numéro de téléphone)
-- ------------------------------------------------------------
create table clients (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,      -- identifiant de connexion
  phone text not null unique,         -- gardé comme contact, plus utilisé pour se connecter
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. PRODUITS (catalogue global, créé uniquement par l'admin)
-- ------------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- ex: Coca-Cola
  image_url text,
  price numeric(10,2) not null,       -- prix fixe, identique partout
  low_stock_threshold int not null default 2,  -- seuil d'alerte fixe
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 6. STOCK PAR VENDEUR (produit x vendeur -> quantité)
-- ------------------------------------------------------------
create table vendor_stock (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity int not null default 0,
  updated_at timestamptz not null default now(),
  unique (vendor_id, product_id)
);

-- ------------------------------------------------------------
-- 7. MODES DE PAIEMENT (gérables dynamiquement par l'admin)
-- type: 'cash' | 'wave' | 'orange_money' | autre futur
-- ------------------------------------------------------------
create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  type text not null,                 -- 'cash' | 'wave' | 'orange_money'
  label text not null,                -- nom affiché, ex: "Wave"
  is_active boolean not null default true,
  merchant_link text,                 -- lien marchand (wave.com/pay/xxx)
  icon_url text,                      -- logo/icône affiché au client (ex: logo Wave)
  api_key_encrypted text,             -- clé API (jamais exposée au client)
  config jsonb default '{}'::jsonb,   -- config additionnelle libre
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8. COMMANDES
-- ------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  vendor_id uuid not null references vendors(id),
  status text not null default 'pending',  -- pending | confirmed | cancelled
  payment_method_id uuid references payment_methods(id),
  is_debt boolean not null default false,  -- payé à crédit ?
  total numeric(10,2) not null default 0,
  cash_amount_received numeric(10,2),      -- si paiement liquide
  confirmed_by_vendor boolean not null default false,
  wave_checkout_id text,                   -- id de session Wave (cos-xxx), si paiement Wave
  wave_transaction_id text,                -- id de transaction Wave une fois payé
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 9. LIGNES DE COMMANDE (détail produits achetés)
-- ------------------------------------------------------------
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity int not null,                -- quantité COMMANDÉE à l'origine (ne change plus après confirmation)
  quantity_taken int,                   -- quantité réellement remise par le vendeur (peut différer si le client a pris moins)
  unit_price numeric(10,2) not null    -- prix au moment de l'achat
);

-- ------------------------------------------------------------
-- 10. DETTES (crédit client, plafond global 1000, tous vendeurs confondus)
-- ------------------------------------------------------------
create table debts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  order_id uuid references orders(id),
  amount numeric(10,2) not null,
  is_repaid boolean not null default false,
  repaid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 11. REMBOURSEMENTS DE DETTE (initiés par le client, confirmés par un vendeur)
-- ------------------------------------------------------------
create table debt_repayments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  debt_ids uuid[] not null,
  amount numeric(10,2) not null,
  payment_method_id uuid references payment_methods(id),
  status text not null default 'pending',   -- pending | confirmed | cancelled
  confirmed_by_vendor_id uuid references vendors(id),
  cash_amount_received numeric(10,2),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

-- ------------------------------------------------------------
-- VUE UTILE : dette totale actuelle d'un client (non remboursée)
-- ------------------------------------------------------------
create view client_current_debt as
select client_id, coalesce(sum(amount), 0) as total_debt
from debts
where is_repaid = false
group by client_id;

-- ------------------------------------------------------------
-- 11. ÉVÉNEMENTS WEBHOOK WAVE (idempotence : Wave peut renvoyer
--     le même événement plusieurs fois, on ne le traite qu'une fois)
-- ------------------------------------------------------------
create table wave_webhook_events (
  id text primary key,           -- id d'événement Wave (ex: EV_QvEZuDSQbLdI)
  type text not null,
  received_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Index utiles
-- ------------------------------------------------------------
create index idx_vendor_stock_vendor on vendor_stock(vendor_id);
create index idx_orders_client on orders(client_id);
create index idx_orders_vendor on orders(vendor_id);
create index idx_debts_client on debts(client_id);
create index idx_orders_wave_checkout_id on orders(wave_checkout_id);

-- ------------------------------------------------------------
-- SÉCURITÉ : activer Row Level Security sur toutes les tables.
-- Aucune "policy" n'est ajoutée exprès : ça bloque tout accès via
-- la clé publique (anon) depuis le navigateur. Seul le serveur de
-- l'appli (clé service_role, qui contourne RLS) peut lire/écrire.
-- ------------------------------------------------------------
alter table buildings enable row level security;
alter table admins enable row level security;
alter table vendors enable row level security;
alter table clients enable row level security;
alter table products enable row level security;
alter table vendor_stock enable row level security;
alter table payment_methods enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table debts enable row level security;
alter table debt_repayments enable row level security;
alter table wave_webhook_events enable row level security;

-- ------------------------------------------------------------
-- Pré-remplir les 26 x 16 bâtiments possibles (A1 -> Z16)
-- Tu pourras supprimer ceux qui ne servent pas depuis l'admin.
-- ------------------------------------------------------------
do $$
declare
  l char(1);
  n int;
begin
  for l in select chr(g) from generate_series(65,90) g loop
    for n in 1..16 loop
      insert into buildings (letter, number) values (l, n)
      on conflict do nothing;
    end loop;
  end loop;
end $$;
