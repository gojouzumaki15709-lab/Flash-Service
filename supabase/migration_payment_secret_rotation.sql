-- ============================================================================
-- migration_payment_secret_rotation.sql
-- ----------------------------------------------------------------------------
-- Corrige le point 🔴10 de l'audit : les secrets Wave (api_key_encrypted,
-- config.webhook_secret) ont été stockés EN CLAIR jusqu'à V3. Le chiffrement
-- AES-256-GCM protège désormais les nouvelles valeurs, mais les valeurs
-- elles-mêmes (les clés Wave réelles) ont potentiellement fuité pendant
-- cette période (logs, dumps DB, accès service_role...). Le chiffrement ne
-- répare pas une clé déjà compromise : seule une vraie rotation (régénérer
-- la clé côté Wave, puis la ressaisir ici) le fait.
--
-- Cette migration ajoute une colonne pour tracer QUAND une rotation a
-- réellement eu lieu, pour que l'admin puisse vérifier depuis l'interface
-- que chaque moyen de paiement a bien été tourné après le déploiement V3,
-- plutôt que de devoir aller lire la base à la main.
-- ============================================================================

alter table payment_methods
  add column if not exists secret_rotated_at timestamptz;

comment on column payment_methods.secret_rotated_at is
  'Date de la dernière rotation réelle de api_key_encrypted ou de
   config.webhook_secret (mise à jour automatiquement par
   app/api/admin/payment-methods/[id]/route.ts à chaque PATCH qui change
   apiKey ou webhookSecret). NULL = jamais tourné depuis l''ajout de cette
   colonne : à vérifier en priorité pour tout moyen de paiement créé avant
   le passage au chiffrement (V3).';
