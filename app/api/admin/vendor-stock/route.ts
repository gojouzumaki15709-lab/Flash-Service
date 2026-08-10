import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

async function requireAdmin() {
  const session = await getSession();
  return session && session.role === "admin" ? session : null;
}

// GET ?vendorId=xxx -> stock complet de ce vendeur (comme /api/vendor/stock mais pour un vendeur choisi par l'admin)
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const vendorId = req.nextUrl.searchParams.get("vendorId");
  if (!vendorId) return NextResponse.json({ error: "vendorId requis." }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("vendor_stock")
    .select("id, quantity, product:products(id, name, image_url, price, low_stock_threshold)")
    .eq("vendor_id", vendorId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stock: data });
}

// body: { vendorId, productId, quantity } -> ajoute le produit au stock de ce
// vendeur ou met à jour la quantité s'il l'a déjà (même logique que côté vendeur).
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const { vendorId, productId, quantity } = await req.json();
  if (!vendorId || !productId || quantity === undefined) {
    return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  }
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 0) {
    return NextResponse.json({ error: "Quantité invalide (doit être un entier positif ou nul)." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("vendor_stock")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    await db
      .from("vendor_stock")
      .update({ quantity: qty, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await db.from("vendor_stock").insert({ vendor_id: vendorId, product_id: productId, quantity: qty });
  }

  return NextResponse.json({ ok: true });
}
