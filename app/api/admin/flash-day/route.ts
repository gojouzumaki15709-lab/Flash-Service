import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

async function requireAdmin() {
  const session = await getSession();
  return session && session.role === "admin" ? session : null;
}

async function isChief(id: string) {
  const db = supabaseAdmin();
  const { data } = await db.from("admins").select("is_chief").eq("id", id).maybeSingle();
  return !!data?.is_chief;
}

// GET -> prochain Flash day à venir (visible par tout admin connecté :
// utile pour préparer la promo côté vendeurs/produits, même si seul le
// chef peut le créer/modifier).
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("flash_days")
    .select("id, scheduled_date, discount_percent, product_1:products!product_id_1(id, name), product_2:products!product_id_2(id, name)")
    .gte("scheduled_date", new Date().toISOString().slice(0, 10))
    .order("scheduled_date", { ascending: true })
    .limit(5);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ flashDays: data || [] });
}

// body: { productId1, productId2, scheduledDate? } (scheduledDate au format
// YYYY-MM-DD ; si absent, une date aléatoire dans les 14 prochains jours et
// non déjà prise est choisie côté serveur — "jour aléatoire chaque deux
// semaines").
// Réservé à l'admin en chef : c'est lui qui choisit les 2 produits (voir
// consigne), et le système le notifiera la veille (voir
// /api/admin/flash-day/notification).
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!(await isChief(session.id))) {
    return NextResponse.json({ error: "Réservé à l'admin en chef." }, { status: 403 });
  }

  const { productId1, productId2, scheduledDate } = await req.json();
  if (!productId1 || !productId2 || productId1 === productId2) {
    return NextResponse.json({ error: "Choisis deux produits différents." }, { status: 400 });
  }

  const db = supabaseAdmin();
  let date = scheduledDate;

  if (!date) {
    const { data: existingDates } = await db
      .from("flash_days")
      .select("scheduled_date")
      .gte("scheduled_date", new Date().toISOString().slice(0, 10));
    const taken = new Set((existingDates || []).map((d) => d.scheduled_date));

    const candidates: string[] = [];
    for (let i = 1; i <= 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      if (!taken.has(iso)) candidates.push(iso);
    }
    if (candidates.length === 0) {
      return NextResponse.json({ error: "Aucune date disponible dans les 14 prochains jours." }, { status: 400 });
    }
    date = candidates[Math.floor(Math.random() * candidates.length)];
  }

  const { data, error } = await db
    .from("flash_days")
    .insert({
      scheduled_date: date,
      product_id_1: productId1,
      product_id_2: productId2,
      created_by: session.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, flashDay: data });
}
