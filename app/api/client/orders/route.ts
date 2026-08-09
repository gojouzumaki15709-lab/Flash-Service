import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET -> historique des achats du client connecté (les plus récents d'abord)
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("orders")
    .select(
      "id, total, status, is_debt, cash_amount_received, created_at, vendor:vendors(name), payment_method:payment_methods(label, type), items:order_items(quantity, unit_price, product:products(name))"
    )
    .eq("client_id", session.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totalSpent = (data || [])
    .filter((o) => o.status === "confirmed")
    .reduce((sum, o) => sum + Number(o.total), 0);

  return NextResponse.json({ orders: data || [], totalSpent });
}
