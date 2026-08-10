import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { hashPassword, createSession } from "@/lib/auth";

// body: { username, phone, name, password }
export async function POST(req: NextRequest) {
  const { username, phone, name, password } = await req.json();

  if (!username || !phone || !name || !password) {
    return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Mot de passe trop court (8 caractères minimum)." }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: existingUsername } = await db
    .from("clients")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (existingUsername) {
    return NextResponse.json({ error: "Ce nom d'utilisateur est déjà pris." }, { status: 409 });
  }

  const { data: existingPhone } = await db.from("clients").select("id").eq("phone", phone).maybeSingle();
  if (existingPhone) {
    return NextResponse.json({ error: "Ce numéro est déjà enregistré." }, { status: 409 });
  }

  const password_hash = await hashPassword(password);
  const { data, error } = await db
    .from("clients")
    .insert({ username, phone, name, password_hash })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Erreur lors de la création du compte." }, { status: 500 });
  }

  await createSession({ id: data.id, role: "client", name: data.name, phone: data.phone });
  return NextResponse.json({ ok: true, redirect: "/client" });
}
