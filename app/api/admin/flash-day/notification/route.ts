import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET -> à appeler quand l'admin en chef ouvre son panneau : renvoie le
// Flash day de demain s'il n'a pas encore été signalé, et marque la
// notification comme envoyée (pour ne pas la répéter à chaque rechargement).
// "le systeme doit prevenir l'admin principal la veille du Flash day".
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data: admin } = await db.from("admins").select("is_chief").eq("id", session.id).maybeSingle();
  if (!admin?.is_chief) {
    return NextResponse.json({ notification: null });
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);

  const { data: flashDay } = await db
    .from("flash_days")
    .select("id, scheduled_date, notified_chief, product_1:products!product_id_1(name), product_2:products!product_id_2(name)")
    .eq("scheduled_date", tomorrowIso)
    .eq("notified_chief", false)
    .maybeSingle();

  if (!flashDay) return NextResponse.json({ notification: null });

  await db.from("flash_days").update({ notified_chief: true }).eq("id", flashDay.id);

  return NextResponse.json({ notification: flashDay });
}
