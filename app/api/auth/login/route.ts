import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { verifyPassword, createSession } from "@/lib/auth";

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
