-- ============================================================================
-- migration_login_rate_limit.sql
-- ----------------------------------------------------------------------------
-- Corrige le point 🟠25 de l'audit : /api/auth/login n'a aucune limite de
-- tentatives, donc un brute-force (identifiant + mot de passe) est possible
-- sans aucun frein.
--
-- Implémentation en base plutôt qu'en mémoire process : sur Vercel/serverless,
-- chaque invocation peut atterrir sur une instance différente, donc un
-- compteur en mémoire (simple objet JS) ne protège quasiment rien en
-- production. Une table + une fonction atomique (verrou consultatif, même
-- pattern que le reste du hardening) donne une limite qui tient réellement.
--
-- Deux compteurs indépendants sont utilisés côté application :
--   - par IP        (empêche un poste unique de bourriner toutes les portes)
--   - par identifiant (empêche un attaquant distribué sur plusieurs IP de
--                       cibler un seul compte)
--
-- Idempotent : peut être rejoué sans erreur.
-- ============================================================================

create table if not exists login_attempts (
  id bigserial primary key,
  bucket_key text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_login_attempts_bucket_time
  on login_attempts (bucket_key, attempted_at);

-- Nettoyage best-effort : évite que la table grossisse indéfiniment. Appelé
-- automatiquement à chaque vérification (voir la fonction ci-dessous), donc
-- pas besoin de tâche cron dédiée pour un volume de trafic modeste.
create or replace function register_login_attempt_atomic(
  p_bucket_key text,
  p_max_attempts int,
  p_window_seconds int
) returns table(allowed boolean, retry_after_seconds int)
language plpgsql
security definer
as $$
declare
  v_count int;
  v_oldest timestamptz;
begin
  -- Un seul appel à la fois par bucket : évite qu'une rafale de requêtes
  -- concurrentes sur le même identifiant/IP contourne la limite en passant
  -- toutes le check "count < max" avant qu'aucune n'ait encore inséré sa ligne.
  perform pg_advisory_xact_lock(hashtext(p_bucket_key));

  delete from login_attempts
   where bucket_key = p_bucket_key
     and attempted_at < now() - (p_window_seconds || ' seconds')::interval;

  select count(*), min(attempted_at) into v_count, v_oldest
    from login_attempts
   where bucket_key = p_bucket_key;

  if v_count >= p_max_attempts then
    return query select
      false,
      greatest(1, p_window_seconds - extract(epoch from (now() - v_oldest))::int);
    return;
  end if;

  insert into login_attempts (bucket_key) values (p_bucket_key);
  return query select true, 0;
end;
$$;

revoke execute on function register_login_attempt_atomic(text, int, int) from public, anon, authenticated;
alter function register_login_attempt_atomic(text, int, int) set search_path = pg_catalog, public;
-- grant execute on function register_login_attempt_atomic(text, int, int) to service_role; (déjà implicite)
