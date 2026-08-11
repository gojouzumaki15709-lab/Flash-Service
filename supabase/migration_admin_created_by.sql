-- Permet à un admin de créer d'autres comptes admin depuis le panneau
-- d'administration. On trace qui a créé qui, comme c'est déjà le cas pour
-- les vendeurs (vendors.created_by). Nullable : le tout premier admin est
-- créé par scripts/create-admin.mjs, sans admin "créateur".
alter table admins
  add column if not exists created_by uuid references admins(id);
