import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { verifyPassword, createSession } from "@/lib/auth";

// body: { role: "admin" | "vendor" | "client", identifier: string, password: string }
// identifier = code (admin/vendor) ou numéro de téléphone (client)
export async function POST(req: NextRequest) {
  const { role, identifier, password } = await req.json();

  if (!role || !identifier || !password) {
    return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  }

  const db = supabaseAdmin();

  if (role === "admin") {
    const { data } = await db.from("admins").select("*").eq("code", identifier).single();
    if (!data || !(await verifyPassword(password, data.password_hash))) {
      return NextResponse.json({ error: "Identifiants incorrects." }, { status: 401 });
    }
    await createSession({ id: data.id, role: "admin", name: data.name });
    return NextResponse.json({ ok: true, redirect: "/admin" });
  }

  if (role === "vendor") {
    const { data } = await db.from("vendors").select("*").eq("code", identifier).single();
    if (!data || !(await verifyPassword(password, data.password_hash))) {
      return NextResponse.json({ error: "Identifiants incorrects." }, { status: 401 });
    }
    await createSession({ id: data.id, role: "vendor", name: data.name, buildingId: data.building_id });
    return NextResponse.json({ ok: true, redirect: "/vendeur" });
  }

  if (role === "client") {
    const { data } = await db.from("clients").select("*").eq("phone", identifier).single();
    if (!data || !(await verifyPassword(password, data.password_hash))) {
      return NextResponse.json({ error: "Identifiants incorrects." }, { status: 401 });
    }
    await createSession({ id: data.id, role: "client", name: data.name, phone: data.phone });
    return NextResponse.json({ ok: true, redirect: "/client" });
  }

  return NextResponse.json({ error: "Rôle invalide." }, { status: 400 });
}
