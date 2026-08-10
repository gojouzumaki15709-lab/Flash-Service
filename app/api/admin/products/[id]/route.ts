import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

async function requireAdmin() {
  const session = await getSession();
  return session && session.role === "admin" ? session : null;
}

// body: { isArchived?, name?, price?, imageUrl?, lowStockThreshold? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const { isArchived, name, price, imageUrl, lowStockThreshold } = await req.json();
  const db = supabaseAdmin();

  const update: Record<string, unknown> = {};
  if (isArchived !== undefined) update.is_archived = isArchived;
  if (name !== undefined) {
    const trimmedName = String(name).trim();
    if (!trimmedName) return NextResponse.json({ error: "Le nom du produit est requis." }, { status: 400 });
    update.name = trimmedName;
  }
  if (price !== undefined) {
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return NextResponse.json({ error: "Prix invalide (doit être positif ou nul)." }, { status: 400 });
    }
    update.price = priceNum;
  }
  if (imageUrl !== undefined) update.image_url = imageUrl;
  if (lowStockThreshold !== undefined) {
    const thresholdNum = Number(lowStockThreshold);
    if (!Number.isInteger(thresholdNum) || thresholdNum < 0) {
      return NextResponse.json({ error: "Seuil d'alerte invalide (doit être un entier positif ou nul)." }, { status: 400 });
    }
    update.low_stock_threshold = thresholdNum;
  }

  const { error } = await db.from("products").update(update).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// "Supprimer" un produit = l'archiver (le masquer partout) sans casser
// l'historique des commandes passées qui le référencent encore.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const db = supabaseAdmin();
  const { error } = await db.from("products").update({ is_archived: true }).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
