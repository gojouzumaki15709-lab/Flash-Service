import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("vendor_stock")
    .select("id, quantity, product:products(id, name, image_url, price, low_stock_threshold, is_archived)")
    .eq("vendor_id", session.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Un produit archivé reste dans vendor_stock pour préserver l'historique,
  // mais ne doit plus apparaître au vendeur comme produit "gérable".
  const visible = (data || []).filter((row: any) => row.product && !row.product.is_archived);
  return NextResponse.json({ stock: visible });
}

// body: { productId, quantity }  -> ajoute/soustrait au stock (réapprovisionnement)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const { productId, quantity } = await req.json();
  const qty = Number(quantity);
  if (!productId || !Number.isInteger(qty) || qty < 0) {
    return NextResponse.json({ error: "Quantité invalide (doit être un entier positif ou nul)." }, { status: 400 });
  }
  const db = supabaseAdmin();

  // Un produit archivé par l'admin n'est plus gérable par le vendeur, même
  // s'il connaît encore son productId (ancien lien, ancien état de page...).
  const { data: product, error: productError } = await db
    .from("products")
    .select("id, is_archived")
    .eq("id", productId)
    .maybeSingle();

  if (productError) return NextResponse.json({ error: productError.message }, { status: 500 });
  if (!product) return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });
  if (product.is_archived) {
    return NextResponse.json({ error: "Ce produit a été archivé et ne peut plus être modifié." }, { status: 400 });
  }

  const { data: existing, error: existingError } = await db
    .from("vendor_stock")
    .select("id")
    .eq("vendor_id", session.id)
    .eq("product_id", productId)
    .maybeSingle();

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  if (existing) {
    const { error: updateError } = await db
      .from("vendor_stock")
      .update({ quantity: qty, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  } else {
    const { error: insertError } = await db
      .from("vendor_stock")
      .insert({ vendor_id: session.id, product_id: productId, quantity: qty });
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
