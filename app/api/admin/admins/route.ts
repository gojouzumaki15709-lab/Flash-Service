import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession, hashPassword } from "@/lib/auth";
import { insertWithGeneratedCode } from "@/lib/identifiers";

async function requireAdmin() {
  const session = await getSession();
  return session && session.role === "admin" ? session : null;
}

// Seul l'admin en chef peut voir/gérer la liste des autres admins : un admin
// "normal" ne doit pas pouvoir en dresser la liste (voir consigne).
async function requireChiefAdmin() {
  const session = await requireAdmin();
  if (!session) return null;
  const db = supabaseAdmin();
  const { data } = await db.from("admins").select("is_chief").eq("id", session.id).maybeSingle();
  return data?.is_chief ? session : null;
}

// Un compte admin a accès à absolument tout (vendeurs, produits, paiements,
// création d'autres admins...) : un mot de passe court le rendrait bien
// plus critique à compromettre qu'un compte vendeur ou client. On exige
// donc un minimum plus strict ici.
const MIN_PASSWORD_LENGTH = 10;

export async function GET() {
  if (!(await requireChiefAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const db = supabaseAdmin();
  // On ne renvoie jamais password_hash : uniquement ce qui est utile pour
  // afficher la liste (qui a créé quoi, quand).
  const { data, error } = await db
    .from("admins")
    .select("id, code, name, is_chief, created_at, created_by:admins!created_by(name)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ admins: data });
}

// DELETE ?id=<adminId> -> réservé à l'admin en chef, qui peut supprimer
// n'importe quel autre compte admin (mais pas se supprimer lui-même, pour
// éviter de se retrouver sans chef).
export async function DELETE(req: NextRequest) {
  const session = await requireChiefAdmin();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });
  if (id === session.id) {
    return NextResponse.json({ error: "Impossible de supprimer son propre compte." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db.from("admins").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// body: { name, password }
// Le code de connexion (ADMxxxxxxxx) est généré automatiquement — voir
// lib/identifiers.ts. Il n'est affiché qu'une seule fois, juste après la
// création : à communiquer au nouvel admin avec son mot de passe, puis à
// oublier côté serveur (seul le hash du mot de passe est conservé).
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const { name, password } = await req.json();
  if (!name || !password) {
    return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  }
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Le mot de passe d'un compte admin doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.` },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const password_hash = await hashPassword(password);
  // Un nouvel admin créé depuis le panneau n'est jamais admin en chef : il
  // n'y a qu'un seul chef, désigné uniquement via
  // scripts/create-chief-admin.mjs (bootstrap) ou une future action dédiée
  // du chef en poste.
  const { data, error } = await insertWithGeneratedCode(db, "admins", (code) => ({
    code,
    name,
    password_hash,
    created_by: session.id,
    is_chief: false,
  }));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, admin: data });
}
