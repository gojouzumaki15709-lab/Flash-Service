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

// body: { isActive?: boolean, buildingId?: string, roomNumber?: number }
// - isActive : réactive ou redésactive un vendeur.
// - buildingId/roomNumber : réassigne le bâtiment/la chambre d'un vendeur
//   (utile notamment après migration_room_model.sql, qui vide building_id
//   de tous les vendeurs existants suite à la refonte du modèle bâtiment).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const { isActive, buildingId, roomNumber } = await req.json();

  const update: Record<string, unknown> = {};

  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") {
      return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
    }
    update.is_active = isActive;
  }

  if (buildingId !== undefined) {
    if (typeof buildingId !== "string" || !buildingId) {
      return NextResponse.json({ error: "Bâtiment invalide." }, { status: 400 });
    }
    update.building_id = buildingId;
  }

  if (roomNumber !== undefined) {
    const roomNum = Number(roomNumber);
    if (!Number.isInteger(roomNum) || roomNum < 1 || roomNum > 96) {
      return NextResponse.json({ error: "Numéro de chambre invalide (1 à 96)." }, { status: 400 });
    }
    update.room_number = roomNum;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("vendors")
    .update(update)
    .eq("id", params.id)
    .select("id, name, is_active, room_number, building:buildings(name)")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Vendeur introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true, vendor: data });
}
