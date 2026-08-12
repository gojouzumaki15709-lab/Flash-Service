-- ============================================================
-- SCHEMA COMPLET - Application de vente de sucreries
-- A exécuter dans Supabase : Project > SQL Editor > New query
-- ============================================================

-- Extension pour générer des UUID
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. BÂTIMENTS (liste fixe : 16 numérotés "1".."16" + 26 lettrés "A".."Z" = 42 bâtiments)
-- ------------------------------------------------------------
create table buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,    -- "1" à "16", ou "A" à "Z"
  created_at timestamptz not null default now()
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
  room_number int not null check (room_number >= 1 and room_number <= 96),  -- chambre du vendeur dans son bâtiment (1-96)
  is_open boolean not null default false,   -- ouvert = connecté / en service
  is_active boolean not null default true,  -- false = désactivé par un admin
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
  price integer not null,             -- prix fixe en FCFA (XOF n'a pas de décimales), identique partout
  low_stock_threshold int not null default 2,  -- seuil d'alerte fixe
  is_archived boolean not null default false,  -- "suppression" douce (préserve l'historique)
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
  total integer not null default 0,        -- FCFA, entier (XOF n'a pas de décimales)
  cash_amount_received integer,            -- si paiement liquide
  confirmed_by_vendor boolean not null default false,
  wave_checkout_id text,                   -- id de session Wave (cos-xxx), si paiement Wave
  wave_transaction_id text,                -- id de transaction Wave une fois payé
  client_room text,                        -- chambre du client au moment de la commande, ex: "B-67"
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
  unit_price integer not null           -- prix (FCFA) au moment de l'achat
);

-- ------------------------------------------------------------
-- 10. ÉVÉNEMENTS WEBHOOK WAVE (idempotence : Wave peut renvoyer
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
alter table wave_webhook_events enable row level security;

-- ------------------------------------------------------------
-- Pré-remplir les 42 bâtiments (16 numérotés "1".."16" + 26 lettrés "A".."Z")
-- Tu pourras supprimer ceux qui ne servent pas depuis l'admin.
-- ------------------------------------------------------------
insert into buildings (name)
select n::text from generate_series(1, 16) n
union all
select chr(g) from generate_series(65, 90) g
on conflict (name) do nothing;
