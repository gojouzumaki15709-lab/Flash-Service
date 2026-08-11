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
// identifier = nom d'utilisateur (client) ou code (vendeur/admin).
// Le rôle n'est plus choisi par la personne qui se connecte : il n'existe
// qu'un seul formulaire de connexion, sans mention de "vendeur" ou
// "admin", pour qu'un client ne sache même pas que ces rôles existent
// (et qu'un vendeur ne sache pas qu'un rôle admin existe). Le serveur
// détecte le rôle en cherchant l'identifiant successivement dans les
// tables clients, puis vendors, puis admins. Comme les identifiants
// clients/vendeurs/admins vivent dans des tables (et donc des espaces de
// noms) séparés, une collision entre un username client et un code
// vendeur/admin est possible en théorie : dans ce cas rare, l'ordre de
// recherche ci-dessous fait primer le compte client.
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

  // On cherche l'identifiant successivement dans les 3 tables, sans que
  // la personne n'ait à préciser (ni à connaître) son rôle. Chaque branche
  // renvoie immédiatement si le mot de passe correspond ; sinon on passe
  // discrètement à la table suivante. Dans tous les cas d'échec (identifiant
  // inconnu partout, mauvais mot de passe, compte désactivé...), le même
  // message générique est renvoyé à la fin : ça ne révèle ni si l'identifiant
  // existe, ni dans quelle table, ni même que d'autres rôles existent.
  const { data: client } = await db.from("clients").select("*").eq("username", identifier).maybeSingle();
  if (client && (await verifyPassword(password, client.password_hash))) {
    await createSession({ id: client.id, role: "client", name: client.name, phone: client.phone });
    return NextResponse.json({ ok: true, redirect: "/client" });
  }

  const { data: vendor } = await db.from("vendors").select("*").eq("code", identifier).maybeSingle();
  if (vendor && (await verifyPassword(password, vendor.password_hash))) {
    // Mot de passe correct, mais compte désactivé par un admin : on ne
    // délivre pas de session, et on tombe dans le message générique
    // ci-dessous (ne révèle pas non plus que le compte existe).
    if (vendor.is_active !== false) {
      await createSession({ id: vendor.id, role: "vendor", name: vendor.name, buildingId: vendor.building_id });
      return NextResponse.json({ ok: true, redirect: "/vendeur" });
    }
  }

  const { data: admin } = await db.from("admins").select("*").eq("code", identifier).maybeSingle();
  if (admin && (await verifyPassword(password, admin.password_hash))) {
    await createSession({ id: admin.id, role: "admin", name: admin.name });
    return NextResponse.json({ ok: true, redirect: "/admin" });
  }

  // Volontairement le même message dans tous les cas d'échec (ne révèle pas
  // si l'identifiant existe, dans quelle table, ni que d'autres rôles existent).
  return NextResponse.json({ error: "Identifiant ou mot de passe incorrect." }, { status: 401 });
}
