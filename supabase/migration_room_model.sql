-- ============================================================
-- migration_room_model.sql
--
-- À exécuter APRÈS migration_client_room.sql.
--
-- Corrige le modèle "bâtiment" qui était faux : la table buildings
-- contenait 26 lettres x 16 numéros (416 lignes), comme si un
-- bâtiment était une COMBINAISON lettre+numéro.
--
-- Modèle réel (confirmé) : il y a 42 bâtiments au total :
--   - 16 bâtiments nommés par un chiffre : "1" à "16"
--   - 26 bâtiments nommés par une lettre : "A" à "Z"
-- Chaque bâtiment (peu importe son type de nom) contient 96
-- chambres, numérotées 1 à 96. "12-67" = chambre 67 du bâtiment
-- 12. "B-67" = chambre 67 du bâtiment B.
--
-- Un vendeur est donc rattaché à UN bâtiment (parmi les 42) ET à
-- UNE chambre (1-96) dans ce bâtiment.
--
-- Effets :
--   1) buildings devient une simple liste de 42 noms (colonne
--      "name" unique) : "1".."16", "A".."Z". Les colonnes letter/
--      number disparaissent.
--   2) vendors gagne une colonne room_number (1-96).
--   3) Comme les anciennes lignes buildings sont supprimées, tout
--      vendor.building_id existant devient invalide -> remis à
--      NULL (colonne rendue temporairement nullable). Si des
--      vendeurs existent déjà, un admin doit rouvrir chacun depuis
--      /admin et réassigner bâtiment + chambre après la migration.
--
-- Idempotent dans la mesure du possible ; le DELETE/reconstruction
-- de buildings, lui, n'a de sens qu'une seule fois.
-- ============================================================

-- ------------------------------------------------------------
-- 1) vendors.building_id doit pouvoir être NULL le temps de la
--    migration (on va vider la table buildings référencée).
-- ------------------------------------------------------------
alter table vendors alter column building_id drop not null;
update vendors set building_id = null;

-- ------------------------------------------------------------
-- 2) Reconstruit buildings : 42 lignes, un "name" unique par
--    bâtiment ("1".."16", "A".."Z").
-- ------------------------------------------------------------
delete from buildings;

alter table buildings drop constraint if exists buildings_letter_number_key;
alter table buildings drop column if exists letter;
alter table buildings drop column if exists number;

alter table buildings add column if not exists name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'buildings_name_key'
  ) then
    alter table buildings alter column name set not null;
    alter table buildings add constraint buildings_name_key unique (name);
  end if;
end $$;

insert into buildings (name)
select n::text from generate_series(1, 16) n            -- bâtiments "1" à "16"
union all
select chr(g) from generate_series(65, 90) g             -- bâtiments "A" à "Z"
on conflict (name) do nothing;

-- ------------------------------------------------------------
-- 3) Chambre du vendeur dans son bâtiment (1 à 96).
-- ------------------------------------------------------------
alter table vendors add column if not exists room_number int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vendors_room_number_range'
  ) then
    alter table vendors
      add constraint vendors_room_number_range
      check (room_number is null or (room_number >= 1 and room_number <= 96));
  end if;
end $$;

comment on column vendors.room_number is
  'Numéro de chambre (1 à 96) du vendeur au sein de son bâtiment (vendors.building_id). Ex: bâtiment 12, chambre 67 = "12-67". Bâtiment B, chambre 67 = "B-67".';

comment on column buildings.name is
  'Nom du bâtiment : "1" à "16" (bâtiments numérotés) ou "A" à "Z" (bâtiments lettrés). 42 bâtiments au total.';
