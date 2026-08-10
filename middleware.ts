import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // Pas de valeur de secours ici non plus : si SESSION_SECRET manque,
    // on doit refuser l'accès plutôt que d'accepter un secret prévisible.
    throw new Error("SESSION_SECRET is required (aucune valeur de secours autorisée).");
  }
  return new TextEncoder().encode(secret);
}

const ROLE_FOR_PATH: Record<string, string> = {
  "/admin": "admin",
  "/vendeur": "vendor",
  "/client": "client",
};

// Un JWT signé valide ne garantit plus, à lui seul, qu'un vendeur a encore
// le droit d'accéder à /vendeur : un admin a pu le désactiver entre-temps.
// Le middleware tourne en edge runtime (pas de @supabase/supabase-js admin
// ici), donc on interroge directement l'API REST de Supabase avec la clé
// service_role, en ne demandant que la colonne is_active.
async function vendorIsActive(vendorId: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Config manquante : on refuse plutôt que de laisser passer par défaut.
    return false;
  }
  try {
    const res = await fetch(
      `${url}/rest/v1/vendors?id=eq.${encodeURIComponent(vendorId)}&select=is_active`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!res.ok) return false;
    const rows = (await res.json()) as Array<{ is_active: boolean }>;
    return rows.length > 0 && rows[0].is_active === true;
  } catch {
    // En cas de panne réseau/DB, on refuse par défaut plutôt que d'accorder
    // l'accès à un vendeur potentiellement désactivé.
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const matchedPrefix = Object.keys(ROLE_FOR_PATH).find((p) => pathname.startsWith(p));
  if (!matchedPrefix) return NextResponse.next();

  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.redirect(new URL("/", req.url));

  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.role !== ROLE_FOR_PATH[matchedPrefix]) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    if (payload.role === "vendor") {
      const active = await vendorIsActive(String(payload.id));
      if (!active) {
        const res = NextResponse.redirect(new URL("/", req.url));
        res.cookies.delete("session");
        return res;
      }
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/", req.url));
  }
}

export const config = {
  matcher: ["/admin/:path*", "/vendeur/:path*", "/client/:path*"],
};
