import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";
import { hashPassword } from "@/lib/auth";

async function requireAdmin() {
  const session = await getSession();
  return session && session.role === "admin" ? session : null;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("vendors")
    .select("id, code, name, is_open, building:buildings(letter, number)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendors: data });
}

// body: { code, name, password, buildingId }
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const { code, name, password, buildingId } = await req.json();
  if (!code || !name || !password || !buildingId) {
    return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const password_hash = await hashPassword(password);
  const { data, error } = await db
    .from("vendors")
    .insert({ code, name, password_hash, building_id: buildingId, created_by: session.id })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, vendor: data });
}
