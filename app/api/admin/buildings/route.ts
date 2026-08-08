import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("buildings")
    .select("id, letter, number")
    .order("letter")
    .order("number");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ buildings: data });
}
