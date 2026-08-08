import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db.from("products").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data });
}

// body: { name, price, imageUrl, lowStockThreshold }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const { name, price, imageUrl, lowStockThreshold } = await req.json();
  if (!name || price === undefined) {
    return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("products")
    .insert({
      name,
      price,
      image_url: imageUrl || null,
      low_stock_threshold: lowStockThreshold ?? 2,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, product: data });
}
