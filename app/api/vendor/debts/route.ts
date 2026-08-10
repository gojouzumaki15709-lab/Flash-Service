import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET ?phone=xxxx -> trouve le client par téléphone et liste ses dettes non remboursées
// (la dette est globale, tous vendeurs confondus, donc n'importe quel vendeur
// peut consulter et enregistrer un remboursement)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const phone = req.nextUrl.searchParams.get("phone")?.trim();
  if (!phone) return NextResponse.json({ error: "Numéro de téléphone requis." }, { status: 400 });

  const db = supabaseAdmin();

  const { data: client } = await db.from("clients").select("id, name, phone").eq("phone", phone).maybeSingle();
  if (!client) return NextResponse.json({ error: "Aucun client trouvé avec ce numéro." }, { status: 404 });

  const { data: debts, error } = await db
    .from("debts")
    .select("id, amount, created_at")
    .eq("client_id", client.id)
    .eq("is_repaid", false)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const total = (debts || []).reduce((sum, d) => sum + Number(d.amount), 0);
  return NextResponse.json({ client, total, debts: debts || [] });
}

// PATCH body: { clientId, debtIds: string[], cashAmountReceived }
// Marque les dettes sélectionnées comme remboursées (le vendeur a reçu l'argent en liquide).
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { clientId, debtIds, cashAmountReceived } = await req.json();
  if (!clientId || !Array.isArray(debtIds) || !debtIds.length) {
    return NextResponse.json({ error: "Sélectionne au moins une dette à rembourser." }, { status: 400 });
  }

  const db = supabaseAdmin();

  const received = cashAmountReceived != null && cashAmountReceived !== "" ? Number(cashAmountReceived) : null;
  if (received != null && (!Number.isFinite(received) || received < 0)) {
    return NextResponse.json({ error: "Somme reçue invalide." }, { status: 400 });
  }

  // Vérification de propriété + verrouillage + écriture atomiques côté
  // PostgreSQL (voir mark_debts_repaid_atomic dans
  // supabase/migration_hardening.sql).
  const { data: rpcResult, error } = await db.rpc("mark_debts_repaid_atomic", {
    p_client_id: clientId,
    p_debt_ids: debtIds,
    p_cash_amount_received: received,
  });

  if (error || !rpcResult) {
    const code = (error?.message || "").split(":")[0];
    if (code === "INVALID_DEBT_SELECTION")
      return NextResponse.json({ error: "Sélection de dettes invalide." }, { status: 400 });
    if (code === "INSUFFICIENT_AMOUNT_RECEIVED")
      return NextResponse.json(
        { error: "La somme reçue est inférieure au total des dettes sélectionnées." },
        { status: 400 }
      );
    return NextResponse.json({ error: "Erreur lors du remboursement." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
