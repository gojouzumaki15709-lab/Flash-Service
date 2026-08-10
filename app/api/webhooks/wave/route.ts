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

  // On ne connaît pas encore quelle méthode de paiement / quel secret utiliser
  // tant qu'on n'a pas retrouvé la commande via client_reference. On retrouve
  // donc d'abord la commande, PUIS on vérifie la signature avec son secret,
  // avant de faire quoi que ce soit d'autre. Cette lecture est en dehors de
  // la transaction : elle ne fait qu'identifier la commande, aucun effet de
  // bord n'a lieu ici (tout l'effet métier est dans process_wave_webhook_atomic).
  const orderId: string | undefined = event.data?.client_reference || undefined;
  const waveCheckoutId: string | undefined = event.data?.id || undefined;

  if (!orderId && !waveCheckoutId) {
    return NextResponse.json({ error: "Référence de commande manquante." }, { status: 400 });
  }

  let orderQuery = db.from("orders").select("id, payment_method_id");
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

  const webhookSecret =
    decryptSecret((paymentMethod?.config as any)?.webhook_secret as string | undefined) ?? undefined;

  if (!webhookSecret || !verifyWaveWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  // À partir d'ici, plus aucune opération séparée : tout (idempotence de
  // l'événement + verrou de la commande + vérifications + effet métier)
  // se passe dans une seule transaction PostgreSQL (voir
  // supabase/migration_hardening_v4.sql). Si quoi que ce soit échoue en
  // cours de route, RIEN n'est appliqué et Wave peut retenter l'appel —
  // contrairement à l'ancien code où l'événement pouvait être marqué
  // "traité" sans que la commande ait réellement été confirmée/annulée.

  const paymentSucceeded =
    event.type === "checkout.session.completed" && event.data?.payment_status === "succeeded";
  const paymentFailed = event.type === "checkout.session.payment_failed";

  // Montant : le XOF n'a pas de décimales. Un montant non entier n'est
  // PAS arrondi (contrairement à l'ancien code) — il est traité comme
  // absent, ce qui fait échouer la vérification de correspondance côté
  // fonction SQL plutôt que de risquer d'accepter un montant approximatif.
  const rawAmount = event.data?.amount != null ? Number(event.data.amount) : null;
  const waveAmount = rawAmount != null && Number.isInteger(rawAmount) ? rawAmount : null;

  // Devise : passée telle quelle (pas de valeur par défaut). La fonction
  // SQL exige une correspondance stricte avec "XOF", donc une devise
  // absente ou différente fait systématiquement échouer la vérification.
  const waveCurrency: string | null = event.data?.currency ?? null;

  const { data: result, error: rpcError } = await db.rpc("process_wave_webhook_atomic", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_order_id: order.id,
    p_payment_succeeded: paymentSucceeded,
    p_payment_failed: paymentFailed,
    p_wave_amount: waveAmount,
    p_wave_currency: waveCurrency,
    p_wave_checkout_id: event.data?.id ?? null,
    p_wave_transaction_id: event.data?.transaction_id ?? null,
  });

  if (rpcError) {
    // Erreur serveur (DB indisponible, etc.) : on laisse Wave réessayer
    // plus tard plutôt que de répondre 200 sur une transaction qui n'a
    // jamais été appliquée.
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }

  return NextResponse.json(result ?? { ok: true });
}
