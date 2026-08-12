import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { verifyWaveWebhookSignature } from "@/lib/wave";
import { decryptSecret } from "@/lib/crypto";

// IMPORTANT : on utilise req.text() pour récupérer le corps BRUT (non parsé),
// indispensable pour que la vérification de signature HMAC fonctionne
// (voir lib/wave.ts). Ne jamais faire req.json() avant la vérification.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("wave-signature");

  let event: { id: string; type: string; data: Record<string, any> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Un remboursement de crédit Flash-points utilise une client_reference
  // préfixée "credit:<id>" (voir app/api/client/credit/repay/route.ts) pour
  // qu'on puisse le distinguer d'une commande normale ici.
  const rawReference: string | undefined = event.data?.client_reference || undefined;
  const isCreditRepayment = !!rawReference?.startsWith("credit:");
  if (isCreditRepayment) {
    return handleCreditRepaymentWebhook(db, rawReference!.slice("credit:".length), event, rawBody, signatureHeader);
  }

  // On ne connaît pas encore quelle méthode de paiement / quel secret utiliser
  // tant qu'on n'a pas retrouvé la commande via client_reference. On retrouve
  // donc d'abord la commande, PUIS on vérifie la signature avec son secret,
  // avant de faire quoi que ce soit d'autre.
  const orderId: string | undefined = rawReference || undefined;
  const waveCheckoutId: string | undefined = event.data?.id || undefined;

  if (!orderId && !waveCheckoutId) {
    return NextResponse.json({ error: "Référence de commande manquante." }, { status: 400 });
  }

  let orderQuery = db
    .from("orders")
    .select("id, status, vendor_id, payment_method_id, wave_checkout_id");
  const { data: order } = orderId
    ? await orderQuery.eq("id", orderId).maybeSingle()
    : await orderQuery.eq("wave_checkout_id", waveCheckoutId).maybeSingle();

  if (!order) {
    // On répond 200 quand même : ce n'est pas à Wave de réessayer indéfiniment
    // pour une commande qu'on ne retrouve pas (peut arriver en test).
    return NextResponse.json({ ok: true, ignored: "Commande introuvable." });
  }

  const { data: paymentMethod } = await db
    .from("payment_methods")
    .select("config")
    .eq("id", order.payment_method_id)
    .maybeSingle();

  const webhookSecret = decryptSecret(
    (paymentMethod?.config as any)?.webhook_secret as string | undefined
  ) ?? undefined;

  if (!webhookSecret || !verifyWaveWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  // Idempotence : Wave peut renvoyer le même événement plusieurs fois.
  const { error: insertEventError } = await db
    .from("wave_webhook_events")
    .insert({ id: event.id, type: event.type });
  if (insertEventError) {
    // code 23505 = violation de contrainte unique -> événement déjà traité
    if ((insertEventError as any).code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    // Autre erreur : on laisse Wave réessayer plus tard.
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }

  if (order.status !== "pending") {
    // Déjà traité (confirmé ou annulé) par un événement précédent.
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  if (event.type === "checkout.session.completed" && event.data?.payment_status === "succeeded") {
    // Vérifie que ce que Wave dit avoir encaissé correspond bien à la
    // commande retrouvée : montant exact et devise XOF. Sans ce contrôle,
    // un événement valide (signature correcte) mais portant sur un
    // montant/checkout différent aurait quand même pu confirmer la
    // commande.
    const { data: orderRow } = await db.from("orders").select("total").eq("id", order.id).single();
    const expectedAmount = orderRow ? Math.round(Number(orderRow.total)) : null;
    const waveAmount = event.data?.amount != null ? Math.round(Number(event.data.amount)) : null;
    const waveCurrency = event.data?.currency;
    const checkoutIdMatches =
      !order.wave_checkout_id || !event.data?.id || event.data.id === order.wave_checkout_id;

    if (
      expectedAmount == null ||
      waveAmount == null ||
      waveAmount !== expectedAmount ||
      (waveCurrency && waveCurrency !== "XOF") ||
      !checkoutIdMatches
    ) {
      // On enregistre quand même l'événement (déjà fait ci-dessus, pour
      // l'idempotence) mais on refuse de confirmer une commande dont le
      // montant/devise/checkout ne correspond pas.
      return NextResponse.json({ ok: true, ignored: "Montant, devise ou session ne correspondent pas." });
    }

    await db
      .from("orders")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        wave_transaction_id: event.data?.transaction_id || null,
        wave_checkout_id: event.data?.id || order.wave_checkout_id,
      })
      .eq("id", order.id);
  } else if (event.type === "checkout.session.payment_failed") {
    // Le paiement a échoué : annule la commande et restitue le stock
    // réservé, de façon atomique (verrouillage des lignes de stock).
    await db.rpc("cancel_pending_order_atomic", { p_order_id: order.id });
  }

  return NextResponse.json({ ok: true });
}

// Traite un événement Wave concernant le remboursement d'un crédit
// Flash-points (client_reference = "credit:<flash_credits.id>"), séparément
// du flux "commande" ci-dessus car il touche flash_credits, pas orders.
async function handleCreditRepaymentWebhook(
  db: ReturnType<typeof supabaseAdmin>,
  creditId: string,
  event: { id: string; type: string; data: Record<string, any> },
  rawBody: string,
  signatureHeader: string | null
) {
  const { data: credit } = await db
    .from("flash_credits")
    .select("id, status, amount, payment_method_id, wave_checkout_id")
    .eq("id", creditId)
    .maybeSingle();

  if (!credit) {
    return NextResponse.json({ ok: true, ignored: "Crédit introuvable." });
  }

  const { data: paymentMethod } = await db
    .from("payment_methods")
    .select("config")
    .eq("id", credit.payment_method_id)
    .maybeSingle();

  const webhookSecret =
    decryptSecret((paymentMethod?.config as any)?.webhook_secret as string | undefined) ?? undefined;

  if (!webhookSecret || !verifyWaveWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  const { error: insertEventError } = await db.from("wave_webhook_events").insert({ id: event.id, type: event.type });
  if (insertEventError) {
    if ((insertEventError as any).code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }

  if (credit.status !== "pending_repayment") {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  if (event.type === "checkout.session.completed" && event.data?.payment_status === "succeeded") {
    const waveAmount = event.data?.amount != null ? Math.round(Number(event.data.amount)) : null;
    const waveCurrency = event.data?.currency;
    const checkoutIdMatches =
      !credit.wave_checkout_id || !event.data?.id || event.data.id === credit.wave_checkout_id;

    if (waveAmount == null || waveAmount !== credit.amount || (waveCurrency && waveCurrency !== "XOF") || !checkoutIdMatches) {
      return NextResponse.json({ ok: true, ignored: "Montant, devise ou session ne correspondent pas." });
    }

    await db
      .from("flash_credits")
      .update({ status: "repaid", repaid_at: new Date().toISOString() })
      .eq("id", creditId);
  }

  return NextResponse.json({ ok: true });
}
