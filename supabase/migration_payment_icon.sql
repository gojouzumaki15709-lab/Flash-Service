-- Migration : icône/logo pour chaque mode de paiement (ex: logo Wave, Orange Money)
alter table payment_methods add column if not exists icon_url text;
