-- ============================================================================
-- migration_vendor_is_active.sql
-- ----------------------------------------------------------------------------
-- Corrige les points 🔴1 / 🔴2 / 🔴27 de l'audit :
--   1) DELETE FROM vendors échoue silencieusement dès qu'un vendeur a de
--      l'historique (orders.vendor_id, debt_repayments.confirmed_by_vendor_id
--      ne sont pas en ON DELETE CASCADE) -> l'admin clique "Supprimer",
--      rien ne se passe, et le frontend ne vérifie même pas res.ok.
--   2) Même supprimé/désactivé, le vendeur garde un JWT valide jusqu'à
--      30 jours : rien ne revérifie son statut en base à chaque requête.
--
-- Principe : on ne supprime plus jamais physiquement un vendeur. On le
-- désactive. L'historique (commandes, remboursements, stock) reste intact.
--
-- Idempotent : peut être rejoué sans erreur.
-- ============================================================================

alter table vendors
  add column if not exists is_active boolean not null default true;

comment on column vendors.is_active is
  'false = vendeur désactivé par un admin. Toute action vendeur (login, API,
   stock, confirmation de commande...) doit être refusée. L''historique
   (orders, debt_repayments, vendor_stock) reste intact : on ne supprime
   jamais physiquement un vendeur ayant de l''historique.';

-- Index utile pour les vérifications fréquentes ("ce vendeur est-il actif ?")
create index if not exists idx_vendors_is_active on vendors (id) where is_active = false;
