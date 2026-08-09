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

  // Vérifier que les dettes sélectionnées appartiennent bien à ce client et sont non remboursées
  const { data: debts } = await db
    .from("debts")
    .select("id, client_id, amount, is_repaid")
    .in("id", debtIds);

  const invalid = (debts || []).find((d) => d.client_id !== clientId || d.is_repaid);
  if (!debts || debts.length !== debtIds.length || invalid) {
    return NextResponse.json({ error: "Sélection de dettes invalide." }, { status: 400 });
  }

  const expectedTotal = debts.reduce((sum, d) => sum + Number(d.amount), 0);
  const received = cashAmountReceived != null && cashAmountReceived !== "" ? Number(cashAmountReceived) : expectedTotal;

  if (received < expectedTotal) {
    return NextResponse.json(
      { error: `La somme reçue (${received} FCFA) est inférieure au total des dettes sélectionnées (${expectedTotal} FCFA).` },
      { status: 400 }
    );
  }

  await db
    .from("debts")
    .update({ is_repaid: true, repaid_at: new Date().toISOString() })
    .in("id", debtIds);

  return NextResponse.json({ ok: true });
}
