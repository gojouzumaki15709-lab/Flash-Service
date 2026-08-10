-- Migration : permet à l'admin de "supprimer" un produit sans casser
-- l'historique des commandes passées (qui référencent products.id).
-- On archive (masque) le produit au lieu de le supprimer physiquement.
alter table products add column if not exists is_archived boolean not null default false;
