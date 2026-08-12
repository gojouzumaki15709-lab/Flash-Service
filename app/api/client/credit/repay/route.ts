import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";
import { createWaveCheckoutSession } from "@/lib/wave";
import { decryptSecret } from "@/lib/crypto";

function siteUrl(req: NextRequest) {
  return process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
}

// body: { creditId, mode: "cash" | "wave", paymentMethodId? }
// - mode "cash" : marque la demande comme en attente de confirmation par un
//   vendeur (n'importe quel vendeur, la dette n'est pas propre à un seul
//   vendeur — voir consigne "confirmé ensuite par n'importe quel vendeur").
// - mode "wave" : lance un paiement Wave direct sur le site pour ce crédit ;
//   la confirmation se fait automatiquement via le webhook Wave.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { creditId, mode, paymentMethodId } = await req.json();
  if (!creditId || !["cash", "wave"].includes(mode)) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: credit, error: creditError } = await db
    .from("flash_credits")
    .select("id, client_id, amount, status")
    .eq("id", creditId)
    .maybeSingle();

  if (creditError || !credit || credit.client_id !== session.id) {
    return NextResponse.json({ error: "Crédit introuvable." }, { status: 404 });
  }
  if (credit.status !== "pending_repayment") {
    return NextResponse.json({ error: "Ce crédit n'est pas remboursable dans cet état." }, { status: 400 });
  }

  if (mode === "cash") {
    const { error } = await db
      .from("flash_credits")
      .update({ status: "repayment_pending_confirmation" })
      .eq("id", creditId)
      .eq("status", "pending_repayment");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, mode: "cash" });
  }

  // mode === "wave"
  if (!paymentMethodId) {
    return NextResponse.json({ error: "Moyen de paiement Wave manquant." }, { status: 400 });
  }
  const { data: paymentMethod } = await db
    .from("payment_methods")
    .select("type, is_active, api_key_encrypted, merchant_link")
    .eq("id", paymentMethodId)
    .maybeSingle();

  if (!paymentMethod || paymentMethod.type !== "wave" || !paymentMethod.is_active) {
    return NextResponse.json({ error: "Moyen de paiement Wave invalide." }, { status: 400 });
  }

  const apiKey = decryptSecret(paymentMethod.api_key_encrypted as string | null);
  if (!apiKey) {
    // Pas de clé API configurée : on retombe sur le lien marchand simple
    // (le client paie, puis un vendeur confirme manuellement comme en cash).
    if (!paymentMethod.merchant_link) {
      return NextResponse.json({ error: "Wave n'est pas configuré pour un paiement direct." }, { status: 400 });
    }
    await db
      .from("flash_credits")
      .update({ status: "repayment_pending_confirmation", payment_method_id: paymentMethodId })
      .eq("id", creditId);
    return NextResponse.json({ ok: true, mode: "wave_link", waveLaunchUrl: paymentMethod.merchant_link });
  }

  try {
    const base = siteUrl(req);
    const waveSession = await createWaveCheckoutSession({
      apiKey,
      amount: credit.amount,
      // Préfixe "credit:" pour que le webhook distingue un remboursement de
      // crédit d'une commande normale (voir app/api/webhooks/wave/route.ts).
      clientReference: `credit:${creditId}`,
      successUrl: `${base}/client?wave=success&credit=${creditId}`,
      errorUrl: `${base}/client?wave=error&credit=${creditId}`,
    });

    await db
      .from("flash_credits")
      .update({ wave_checkout_id: waveSession.id, payment_method_id: paymentMethodId })
      .eq("id", creditId);

    return NextResponse.json({ ok: true, mode: "wave_api", waveLaunchUrl: waveSession.wave_launch_url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    return NextResponse.json({ error: `Impossible de démarrer le paiement Wave : ${message}` }, { status: 502 });
  }
}
