import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// On ne supprime plus jamais physiquement un vendeur : dès qu'il a de
// l'historique (orders.vendor_id, debt_repayments.confirmed_by_vendor_id,
// qui ne sont pas en ON DELETE CASCADE), un DELETE brut échoue côté
// PostgreSQL et l'admin voit juste le vendeur "ne pas disparaître" sans
// aucun message d'erreur clair. À la place : désactivation (is_active =
// false). L'historique reste intact, et getSession()/middleware refusent
// désormais toute action de ce vendeur dès que ce flag passe à false
// (voir lib/auth.ts et middleware.ts).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("vendors")
    .update({ is_active: false })
    .eq("id", params.id)
    .select("id, name, is_active")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Vendeur introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true, vendor: data });
}

// body: { isActive: boolean } -> réactive ou redésactive un vendeur.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const { isActive } = await req.json();
  if (typeof isActive !== "boolean") {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("vendors")
    .update({ is_active: isActive })
    .eq("id", params.id)
    .select("id, name, is_active")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Vendeur introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true, vendor: data });
}
