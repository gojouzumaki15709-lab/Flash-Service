import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("vendor_stock")
    .select("quantity, vendor:vendors(name), product:products(name, low_stock_threshold)");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const low = (data || []).filter((row: any) => row.quantity <= (row.product?.low_stock_threshold ?? 2));
  return NextResponse.json({ lowStock: low });
}
