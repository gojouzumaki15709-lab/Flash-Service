import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

// Simple ping : vérifie que le serveur ET la base de données répondent.
// Public volontairement (pas d'info sensible renvoyée), pratique pour un
// service de monitoring externe (UptimeRobot, etc.) ou un simple test manuel.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = supabaseAdmin();
    const { error } = await db.from("buildings").select("id").limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, db: "up", time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 500 });
  }
}
