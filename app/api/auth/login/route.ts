import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { verifyPassword, createSession } from "@/lib/auth";

// Fenêtres volontairement asymétriques : une IP peut légitimement héberger
// plusieurs vendeurs/clients (même bâtiment, même réseau), donc sa limite
// est plus large. Un identifiant précis, lui, ne devrait jamais avoir
// besoin de plus de 5 tentatives en 15 minutes dans un usage normal.
const IP_MAX_ATTEMPTS = 20;
const IDENTIFIER_MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60;

function clientIp(req: NextRequest): string {
  // Sur Vercel (et la plupart des reverse proxies), l'IP réelle du client
  // est dans x-forwarded-for (premier élément de la liste). NextRequest
  // n'expose plus req.ip de façon fiable en App Router.
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// body: { identifier: string, password: string }
// identifier = code (admin/vendeur) ou nom d'utilisateur (client).
// Le rôle n'est jamais demandé à l'utilisateur : on le déduit en cherchant
// l'identifiant dans les 3 tables. Ça évite d'exposer publiquement qu'un
// login "admin" ou "vendeur" existe.
export async function POST(req: NextRequest) {
  const { identifier, password } = await req.json();

  if (!identifier || !password) {
    return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Rate limiting : une tentative (réussie ou non) consomme un slot des
  // deux compteurs. C'est volontairement strict — un utilisateur légitime
  // qui se trompe 5 fois en 15 minutes devra patienter — car la protection
  // contre le brute-force prime ici sur le confort en cas d'erreur de
  // frappe répétée.
  const ip = clientIp(req);
  const identifierKey = String(identifier).trim().toLowerCase();

  const { data: ipCheck, error: ipCheckError } = await db.rpc("register_login_attempt_atomic", {
    p_bucket_key: `ip:${ip}`,
    p_max_attempts: IP_MAX_ATTEMPTS,
    p_window_seconds: WINDOW_SECONDS,
  });
  const { data: idCheck, error: idCheckError } = await db.rpc("register_login_attempt_atomic", {
    p_bucket_key: `id:${identifierKey}`,
    p_max_attempts: IDENTIFIER_MAX_ATTEMPTS,
    p_window_seconds: WINDOW_SECONDS,
  });

  // Si le rate limiting lui-même échoue (DB indisponible, migration pas
  // encore appliquée...), on choisit de laisser passer plutôt que de
  // bloquer tous les logins de l'application à cause d'un problème
  // secondaire — mais l'erreur est loguée pour ne pas passer inaperçue.
  if (ipCheckError) console.error("[login] rate limit IP check failed:", ipCheckError.message);
  if (idCheckError) console.error("[login] rate limit identifier check failed:", idCheckError.message);

  const ipResult = ipCheck?.[0];
  const idResult = idCheck?.[0];
  const blocked = (ipResult && ipResult.allowed === false) || (idResult && idResult.allowed === false);

  if (blocked) {
    const retryAfter = Math.max(ipResult?.retry_after_seconds || 0, idResult?.retry_after_seconds || 0);
    return NextResponse.json(
      { error: "Trop de tentatives. Réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  // 1. Essayer admin
  const { data: admin } = await db.from("admins").select("*").eq("code", identifier).maybeSingle();
  if (admin && (await verifyPassword(password, admin.password_hash))) {
    await createSession({ id: admin.id, role: "admin", name: admin.name });
    return NextResponse.json({ ok: true, redirect: "/admin" });
  }

  // 2. Essayer vendeur
  const { data: vendor } = await db.from("vendors").select("*").eq("code", identifier).maybeSingle();
  if (vendor && (await verifyPassword(password, vendor.password_hash))) {
    if (vendor.is_active === false) {
      // Mot de passe correct, mais compte désactivé par un admin : on ne
      // délivre pas de session. Message générique, cohérent avec le reste
      // de la route (on ne veut pas révéler l'existence du compte non plus).
      return NextResponse.json({ error: "Identifiant ou mot de passe incorrect." }, { status: 401 });
    }
    await createSession({ id: vendor.id, role: "vendor", name: vendor.name, buildingId: vendor.building_id });
    return NextResponse.json({ ok: true, redirect: "/vendeur" });
  }

  // 3. Essayer client
  const { data: client } = await db.from("clients").select("*").eq("username", identifier).maybeSingle();
  if (client && (await verifyPassword(password, client.password_hash))) {
    await createSession({ id: client.id, role: "client", name: client.name, phone: client.phone });
    return NextResponse.json({ ok: true, redirect: "/client" });
  }

  // Volontairement le même message dans tous les cas d'échec (ne révèle pas
  // si l'identifiant existe ou non, ni à quel rôle il appartient).
  return NextResponse.json({ error: "Identifiant ou mot de passe incorrect." }, { status: 401 });
}
