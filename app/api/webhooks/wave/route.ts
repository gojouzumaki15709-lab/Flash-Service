import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { verifyWaveWebhookSignature } from "@/lib/wave";

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

  // On ne connaît pas encore quelle méthode de paiement / quel secret utiliser
  // tant qu'on n'a pas retrouvé la commande via client_reference. On retrouve
  // donc d'abord la commande, PUIS on vérifie la signature avec son secret,
  // avant de faire quoi que ce soit d'autre.
  const orderId: string | undefined = event.data?.client_reference || undefined;
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

  const webhookSecret = (paymentMethod?.config as any)?.webhook_secret as string | undefined;

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
    await db
      .from("orders")
      .update({
        status: "confirmed",
        wave_transaction_id: event.data?.transaction_id || null,
        wave_checkout_id: event.data?.id || order.wave_checkout_id,
      })
      .eq("id", order.id);
  } else if (event.type === "checkout.session.payment_failed") {
    // Le paiement a échoué : on annule la commande et on restitue le stock
    // qui avait été réservé à la création de la commande.
    const { data: orderItems } = await db
      .from("order_items")
      .select("product_id, quantity")
      .eq("order_id", order.id);

    for (const item of orderItems || []) {
      const { data: stockRow } = await db
        .from("vendor_stock")
        .select("id, quantity")
        .eq("vendor_id", order.vendor_id)
        .eq("product_id", item.product_id)
        .maybeSingle();
      if (stockRow) {
        await db
          .from("vendor_stock")
          .update({ quantity: stockRow.quantity + item.quantity, updated_at: new Date().toISOString() })
          .eq("id", stockRow.id);
      }
    }

    await db.from("orders").update({ status: "cancelled" }).eq("id", order.id);
  }

  return NextResponse.json({ ok: true });
}
