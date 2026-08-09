-- Migration : ajout d'un nom d'utilisateur pour les clients (connexion unifiée)
-- Le téléphone reste en base (contact), mais la connexion se fait désormais par username.
alter table clients add column if not exists username text;

-- Remplir un username temporaire pour les clients déjà existants (basé sur leur téléphone)
-- afin que la contrainte "unique" ci-dessous ne plante pas si des comptes existent déjà.
update clients set username = phone where username is null;

alter table clients alter column username set not null;
alter table clients add constraint clients_username_key unique (username);
