import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";
import { hashPassword } from "@/lib/auth";
import { insertWithGeneratedCode } from "@/lib/identifiers";

async function requireAdmin() {
  const session = await getSession();
  return session && session.role === "admin" ? session : null;
}

function isValidRoomNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 96;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("vendors")
    .select("id, code, name, is_open, is_active, room_number, building:buildings(name)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendors: data });
}

// body: { name, password, buildingId, roomNumber }
// Le code de connexion (VENxxxxxx) n'est plus saisi par l'admin : il est
// généré par le système pour rester simple et homogène.
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const { name, password, buildingId, roomNumber } = await req.json();
  if (!name || !password || !buildingId) {
    return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  }
  const roomNum = Number(roomNumber);
  if (!isValidRoomNumber(roomNum)) {
    return NextResponse.json({ error: "Numéro de chambre invalide (1 à 96)." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const password_hash = await hashPassword(password);
  const { data, error } = await insertWithGeneratedCode(db, "vendors", (code) => ({
    code,
    name,
    password_hash,
    building_id: buildingId,
    room_number: roomNum,
    created_by: session.id,
  }));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, vendor: data });
}
