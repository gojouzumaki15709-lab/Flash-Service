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
    .select("id, quantity, product:products(id, name, image_url, price, low_stock_threshold)")
    .eq("vendor_id", session.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stock: data });
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

  const { data: existing } = await db
    .from("vendor_stock")
    .select("id")
    .eq("vendor_id", session.id)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    await db
      .from("vendor_stock")
      .update({ quantity: qty, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await db.from("vendor_stock").insert({ vendor_id: session.id, product_id: productId, quantity: qty });
  }

  return NextResponse.json({ ok: true });
}
