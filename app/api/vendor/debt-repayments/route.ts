import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET -> liste toutes les demandes de remboursement en attente (dette globale,
// donc n'importe quel vendeur peut voir et confirmer, comme pour la recherche par téléphone)
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("debt_repayments")
    .select("id, amount, created_at, debt_ids, client:clients(name, phone), payment_method:payment_methods(type, label)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ repayments: data });
}

// PATCH body: { repaymentId, action: "confirm" | "reject", cashAmountReceived? }
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { repaymentId, action, cashAmountReceived } = await req.json();
  if (!repaymentId || !["confirm", "reject"].includes(action)) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: repayment } = await db
    .from("debt_repayments")
    .select("id, status, amount, debt_ids")
    .eq("id", repaymentId)
    .single();

  if (!repayment) return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  if (repayment.status !== "pending") {
    return NextResponse.json({ error: "Cette demande n'est plus en attente." }, { status: 400 });
  }

  if (action === "reject") {
    await db.from("debt_repayments").update({ status: "cancelled" }).eq("id", repaymentId);
    return NextResponse.json({ ok: true });
  }

  const received = cashAmountReceived != null && cashAmountReceived !== "" ? Number(cashAmountReceived) : repayment.amount;
  if (received < repayment.amount) {
    return NextResponse.json(
      { error: `La somme reçue (${received} FCFA) est inférieure au montant attendu (${repayment.amount} FCFA).` },
      { status: 400 }
    );
  }

  // Marquer les dettes couvertes comme remboursées
  await db
    .from("debts")
    .update({ is_repaid: true, repaid_at: new Date().toISOString() })
    .in("id", repayment.debt_ids);

  await db
    .from("debt_repayments")
    .update({
      status: "confirmed",
      confirmed_by_vendor_id: session.id,
      cash_amount_received: received,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", repaymentId);

  return NextResponse.json({ ok: true });
}
