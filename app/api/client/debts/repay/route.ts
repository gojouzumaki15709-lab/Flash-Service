import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

function siteUrl(req: NextRequest) {
  return process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
}

// body: { debtIds: string[], paymentMethodId: string | null }
// paymentMethodId = null -> le client annonce qu'il paiera en liquide en personne.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { debtIds, paymentMethodId } = await req.json();
  if (!Array.isArray(debtIds) || !debtIds.length) {
    return NextResponse.json({ error: "Sélectionne au moins une dette à rembourser." }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Vérifier que ces dettes appartiennent bien au client et sont non remboursées
  const { data: debts } = await db
    .from("debts")
    .select("id, client_id, amount, is_repaid")
    .in("id", debtIds);

  const invalid = (debts || []).find((d) => d.client_id !== session.id || d.is_repaid);
  if (!debts || debts.length !== debtIds.length || invalid) {
    return NextResponse.json({ error: "Sélection de dettes invalide." }, { status: 400 });
  }

  const amount = debts.reduce((sum, d) => sum + Number(d.amount), 0);

  // Vérifier qu'il n'y a pas déjà une demande de remboursement en attente sur ces dettes
  const { data: existingPending } = await db
    .from("debt_repayments")
    .select("id, debt_ids")
    .eq("client_id", session.id)
    .eq("status", "pending");

  const alreadyPending = (existingPending || []).some((r) => r.debt_ids.some((id: string) => debtIds.includes(id)));
  if (alreadyPending) {
    return NextResponse.json(
      { error: "Une demande de remboursement est déjà en attente pour au moins une de ces dettes." },
      { status: 409 }
    );
  }

  let paymentType: string | null = null;
  let merchantLink: string | null = null;
  let apiKey: string | null = null;
  let isActive = true;

  if (paymentMethodId) {
    const { data: pm } = await db
      .from("payment_methods")
      .select("type, merchant_link, api_key_encrypted, is_active")
      .eq("id", paymentMethodId)
      .single();
    if (pm) {
      paymentType = pm.type;
      merchantLink = pm.merchant_link;
      apiKey = pm.api_key_encrypted;
      isActive = pm.is_active;
    }
    if (!isActive) {
      return NextResponse.json({ error: "Ce mode de paiement n'est plus disponible." }, { status: 400 });
    }
  }

  const { data: repayment, error } = await db
    .from("debt_repayments")
    .insert({
      client_id: session.id,
      debt_ids: debtIds,
      amount,
      payment_method_id: paymentMethodId || null,
      status: "pending",
    })
    .select()
    .single();

  if (error || !repayment) {
    return NextResponse.json({ error: "Erreur lors de la création de la demande." }, { status: 500 });
  }

  // Wave en mode lien simple (pas de clé API) : on renvoie juste le lien marchand.
  if (paymentType === "wave" && !apiKey && merchantLink) {
    return NextResponse.json({ ok: true, repayment, waveLaunchUrl: merchantLink, waveMode: "link" });
  }

  // Wave en mode API pourra être branché ici plus tard (createWaveCheckoutSession),
  // suivant exactement le même principe que pour les commandes.

  return NextResponse.json({ ok: true, repayment });
}
