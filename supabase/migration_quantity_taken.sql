-- ============================================================
-- MIGRATION : quantité réellement remise par article de commande
-- À exécuter dans Supabase : Project > SQL Editor > New query
-- Sans danger sur une base existante (IF NOT EXISTS).
-- ============================================================

-- "quantity" reste la quantité COMMANDÉE à l'origine (ne change plus jamais
-- après confirmation). "quantity_taken" est la quantité réellement remise
-- par le vendeur — peut être inférieure si le client a pris moins que prévu.
-- Reste NULL tant que la commande n'a pas été confirmée par un vendeur.
alter table order_items add column if not exists quantity_taken int;
