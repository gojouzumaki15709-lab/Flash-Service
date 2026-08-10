import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET -> dette actuelle du client connecté + dettes déjà couvertes par une
// demande de remboursement en attente (pour griser ces cases côté interface)
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data: debts, error } = await db
    .from("debts")
    .select("id, amount, created_at, order:orders(vendor:vendors(name))")
    .eq("client_id", session.id)
    .eq("is_repaid", false)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: pendingRepayments } = await db
    .from("debt_repayments")
    .select("debt_ids")
    .eq("client_id", session.id)
    .eq("status", "pending");

  const pendingDebtIds = Array.from(
    new Set((pendingRepayments || []).flatMap((r) => r.debt_ids as string[]))
  );

  const total = (debts || []).reduce((sum, d) => sum + Number(d.amount), 0);
  return NextResponse.json({ total, debts: debts || [], pendingDebtIds });
}
