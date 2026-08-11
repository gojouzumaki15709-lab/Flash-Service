import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession, hashPassword } from "@/lib/auth";
import { insertWithGeneratedCode } from "@/lib/identifiers";

async function requireAdmin() {
  const session = await getSession();
  return session && session.role === "admin" ? session : null;
}

// Un compte admin a accès à absolument tout (vendeurs, produits, paiements,
// création d'autres admins...) : un mot de passe court le rendrait bien
// plus critique à compromettre qu'un compte vendeur ou client. On exige
// donc un minimum plus strict ici.
const MIN_PASSWORD_LENGTH = 10;

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const db = supabaseAdmin();
  // On ne renvoie jamais password_hash : uniquement ce qui est utile pour
  // afficher la liste (qui a créé quoi, quand).
  const { data, error } = await db
    .from("admins")
    .select("id, code, name, created_at, created_by:admins!created_by(name)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ admins: data });
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
  const { data, error } = await insertWithGeneratedCode(db, "admins", (code) => ({
    code,
    name,
    password_hash,
    created_by: session.id,
  }));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, admin: data });
}
