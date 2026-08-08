import { createClient } from "@supabase/supabase-js";

// ATTENTION : ce client utilise la clé service_role.
// Il ne doit JAMAIS être importé dans un composant client ("use client").
// Uniquement dans les routes API (app/api/**/route.ts) et Server Components.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
