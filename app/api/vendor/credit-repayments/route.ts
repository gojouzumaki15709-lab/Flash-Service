import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET -> liste des remboursements de crédit en attente de confirmation.
// La dette est globale au client (pas propre à un vendeur) : n'importe quel
// vendeur connecté peut voir et confirmer ces demandes de remboursement.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("flash_credits")
    .select("id, amount, created_at, client:clients(name, phone), order:orders(client_room)")
    .eq("status", "repayment_pending_confirmation")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ repayments: data || [] });
}

function errorMessageFor(code: string): { message: string; status: number } {
  if (code === "CREDIT_NOT_FOUND") return { message: "Crédit introuvable.", status: 404 };
  if (code === "CREDIT_NOT_REPAYABLE") return { message: "Ce crédit n'est plus remboursable.", status: 400 };
  if (code === "INSUFFICIENT_AMOUNT_RECEIVED") return { message: "La somme reçue est inférieure au montant dû.", status: 400 };
  return { message: "Erreur lors de la confirmation.", status: 500 };
}

// body: { creditId, cashAmountReceived }
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { creditId, cashAmountReceived } = await req.json();
  const amount = Number(cashAmountReceived);
  if (!creditId || !Number.isInteger(amount) || amount < 0) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db.rpc("confirm_flash_credit_cash_repayment_atomic", {
    p_credit_id: creditId,
    p_vendor_id: session.id,
    p_cash_amount_received: amount,
  });

  if (error) {
    const code = (error.message || "").split(":")[0] || "UNKNOWN";
    const { message, status } = errorMessageFor(code);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
