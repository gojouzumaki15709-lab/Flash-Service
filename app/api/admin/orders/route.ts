import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET -> pour l'admin : commandes en attente (avec infos) + commandes
// confirmées récentes (montant, vendeur, heure de création et de
// validation) pour faciliter la vérification.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();

  const baseSelect =
    "id, total, status, is_debt, cash_amount_received, created_at, confirmed_at, " +
    "vendor:vendors(name), client:clients(name, phone), payment_method:payment_methods(label, type), " +
    "items:order_items(quantity, quantity_taken, unit_price, product:products(name))";

  const { data: pending, error: pendingError } = await db
    .from("orders")
    .select(baseSelect)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (pendingError) return NextResponse.json({ error: pendingError.message }, { status: 500 });

  const { data: confirmed, error: confirmedError } = await db
    .from("orders")
    .select(baseSelect)
    .eq("status", "confirmed")
    .order("confirmed_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (confirmedError) return NextResponse.json({ error: confirmedError.message }, { status: 500 });

  return NextResponse.json({ pending: pending || [], confirmed: confirmed || [] });
}
