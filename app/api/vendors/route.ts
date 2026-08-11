import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("vendors")
    .select("id, name, is_open, room_number, building:buildings(name)")
    .eq("is_active", true)
    .order("is_open", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendors: data });
}
