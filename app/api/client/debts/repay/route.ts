import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";

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
      apiKey = decryptSecret(pm.api_key_encrypted);
      isActive = pm.is_active;
    }
    if (!isActive) {
      return NextResponse.json({ error: "Ce mode de paiement n'est plus disponible." }, { status: 400 });
    }
  }

  // Vérifie la propriété des dettes, l'absence de demande concurrente
  // couvrant les mêmes dettes, et crée la demande — tout de façon
  // atomique (verrou consultatif par client) côté PostgreSQL. Voir
  // create_debt_repayment_atomic dans supabase/migration_hardening.sql.
  const { data: rpcResult, error } = await db.rpc("create_debt_repayment_atomic", {
    p_client_id: session.id,
    p_debt_ids: debtIds,
    p_payment_method_id: paymentMethodId || null,
  });

  if (error || !rpcResult) {
    const code = (error?.message || "").split(":")[0];
    if (code === "INVALID_DEBT_SELECTION")
      return NextResponse.json({ error: "Sélection de dettes invalide." }, { status: 400 });
    if (code === "REPAYMENT_ALREADY_PENDING")
      return NextResponse.json(
        { error: "Une demande de remboursement est déjà en attente pour au moins une de ces dettes." },
        { status: 409 }
      );
    return NextResponse.json({ error: "Erreur lors de la création de la demande." }, { status: 500 });
  }

  const repayment = { id: rpcResult.repayment_id, amount: rpcResult.amount };

  // Wave en mode lien simple (pas de clé API) : on renvoie juste le lien marchand.
  if (paymentType === "wave" && !apiKey && merchantLink) {
    return NextResponse.json({ ok: true, repayment, waveLaunchUrl: merchantLink, waveMode: "link" });
  }

  // Wave en mode API pourra être branché ici plus tard (createWaveCheckoutSession),
  // suivant exactement le même principe que pour les commandes.

  return NextResponse.json({ ok: true, repayment });
}
