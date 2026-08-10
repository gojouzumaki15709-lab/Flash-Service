import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET ?includeArchived=true -> renvoie aussi les produits archivés (utilisé par
// l'onglet admin, qui doit pouvoir les afficher/restaurer). Par défaut (utilisé
// par le catalogue client et le choix de produit du vendeur), on masque les
// produits archivés.
export async function GET(req: NextRequest) {
  const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "true";
  const db = supabaseAdmin();
  let query = db.from("products").select("*").order("name");
  if (!includeArchived) query = query.eq("is_archived", false);
  const { data, error } = await query;
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
  const trimmedName = String(name).trim();
  const priceNum = Number(price);
  const thresholdNum = lowStockThreshold === undefined ? 2 : Number(lowStockThreshold);
  if (!trimmedName) {
    return NextResponse.json({ error: "Le nom du produit est requis." }, { status: 400 });
  }
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    return NextResponse.json({ error: "Prix invalide (doit être positif ou nul)." }, { status: 400 });
  }
  if (!Number.isInteger(thresholdNum) || thresholdNum < 0) {
    return NextResponse.json({ error: "Seuil d'alerte invalide (doit être un entier positif ou nul)." }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("products")
    .insert({
      name: trimmedName,
      price: priceNum,
      image_url: imageUrl || null,
      low_stock_threshold: thresholdNum,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, product: data });
}
