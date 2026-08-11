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

  // Verrouillage + vérification + écriture atomiques côté PostgreSQL
  // (voir supabase/migration_hardening.sql) : empêche deux vendeurs de
  // confirmer/rejeter la même demande en même temps.
  if (action === "reject") {
    const { error } = await db.rpc("reject_debt_repayment_atomic", { p_repayment_id: repaymentId });
    if (error) {
      const code = (error.message || "").split(":")[0];
      if (code === "NOT_FOUND") return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
      if (code === "ALREADY_PROCESSED")
        return NextResponse.json({ error: "Cette demande n'est plus en attente." }, { status: 400 });
      return NextResponse.json({ error: "Erreur lors du rejet." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const received = cashAmountReceived != null && cashAmountReceived !== "" ? Number(cashAmountReceived) : null;
  if (received != null && (!Number.isInteger(received) || received < 0)) {
    return NextResponse.json({ error: "Somme reçue invalide (doit être un entier, le FCFA n'a pas de centimes)." }, { status: 400 });
  }

  const { error } = await db.rpc("confirm_debt_repayment_atomic", {
    p_repayment_id: repaymentId,
    p_vendor_id: session.id,
    p_cash_amount_received: received,
  });

  if (error) {
    const code = (error.message || "").split(":")[0];
    if (code === "NOT_FOUND") return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
    if (code === "ALREADY_PROCESSED")
      return NextResponse.json({ error: "Cette demande n'est plus en attente." }, { status: 400 });
    if (code === "INSUFFICIENT_AMOUNT_RECEIVED")
      return NextResponse.json({ error: "La somme reçue est inférieure au montant attendu." }, { status: 400 });
    return NextResponse.json({ error: "Erreur lors de la confirmation." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
