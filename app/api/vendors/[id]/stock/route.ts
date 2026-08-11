import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  // Un vendeur désactivé par un admin est totalement invisible côté client,
  // y compris son stock : on ne s'appuie pas uniquement sur l'archivage
  // produit, on vérifie d'abord le statut du vendeur lui-même.
  const { data: vendor, error: vendorError } = await db
    .from("vendors")
    .select("id, is_active")
    .eq("id", params.id)
    .maybeSingle();

  if (vendorError) return NextResponse.json({ error: vendorError.message }, { status: 500 });
  if (!vendor || !vendor.is_active) {
    return NextResponse.json({ error: "VENDOR_NOT_FOUND" }, { status: 404 });
  }

  const { data, error } = await db
    .from("vendor_stock")
    .select("id, quantity, product:products(id, name, image_url, price, low_stock_threshold, is_archived)")
    .eq("vendor_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // On masque côté client les produits archivés par l'admin, même s'ils
  // restent techniquement dans le stock du vendeur (historique).
  const visible = (data || []).filter((row: any) => row.product && !row.product.is_archived);
  return NextResponse.json({ stock: visible });
}
