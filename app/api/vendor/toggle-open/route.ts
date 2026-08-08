import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const { isOpen } = await req.json();
  const db = supabaseAdmin();
  const { error } = await db.from("vendors").update({ is_open: !!isOpen }).eq("id", session.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
