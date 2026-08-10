import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
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
