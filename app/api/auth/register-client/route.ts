import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { hashPassword, createSession } from "@/lib/auth";

// body: { phone, name, password }
export async function POST(req: NextRequest) {
  const { phone, name, password } = await req.json();

  if (!phone || !name || !password) {
    return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  }
  if (password.length < 4) {
    return NextResponse.json({ error: "Mot de passe trop court (4 caractères minimum)." }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: existing } = await db.from("clients").select("id").eq("phone", phone).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "Ce numéro est déjà enregistré." }, { status: 409 });
  }

  const password_hash = await hashPassword(password);
  const { data, error } = await db
    .from("clients")
    .insert({ phone, name, password_hash })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Erreur lors de la création du compte." }, { status: 500 });
  }

  await createSession({ id: data.id, role: "client", name: data.name, phone: data.phone });
  return NextResponse.json({ ok: true, redirect: "/client" });
}
