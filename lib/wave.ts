import crypto from "crypto";

const WAVE_BASE_URL = "https://api.wave.com";

export interface WaveCheckoutSession {
  id: string; // ex: cos-18qq25rgr100a
  amount: string;
  checkout_status: "open" | "complete" | "expired";
  payment_status: "processing" | "cancelled" | "succeeded";
  wave_launch_url: string;
  client_reference: string | null;
  success_url: string;
  error_url: string;
  when_created: string;
  when_expires: string;
}

interface CreateSessionParams {
  apiKey: string;
  amount: number; // FCFA, entier (XOF n'a pas de décimales)
  clientReference: string; // on y met l'id de la commande
  successUrl: string;
  errorUrl: string;
}

/**
 * Crée une session de paiement Wave (POST /v1/checkout/sessions).
 * Doc : https://docs.wave.com/checkout
 */
export async function createWaveCheckoutSession(
  params: CreateSessionParams
): Promise<WaveCheckoutSession> {
  // XOF n'a pas de décimales : orders.total est maintenant un entier en base
  // (voir supabase/migration_v11_xof_integer_amounts.sql), donc un montant
  // non entier ici signale un bug ailleurs. On ne l'arrondit plus
  // silencieusement (ça masquait des écarts) : on refuse explicitement.
  if (!Number.isInteger(params.amount)) {
    throw new Error(`Montant XOF invalide (non entier) : ${params.amount}`);
  }

  const res = await fetch(`${WAVE_BASE_URL}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: String(params.amount), // XOF : pas de décimales, montant en string
      currency: "XOF",
      client_reference: params.clientReference,
      success_url: params.successUrl,
      error_url: params.errorUrl,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    const message =
      data?.error_message || data?.message || data?.error_code || "Erreur inconnue de l'API Wave.";
    throw new Error(`Wave a refusé la création de la session : ${message}`);
  }

  return data as WaveCheckoutSession;
}

/**
 * Récupère une session existante (utile pour re-vérifier un statut si besoin).
 */
export async function retrieveWaveCheckoutSession(apiKey: string, sessionId: string) {
  const res = await fetch(`${WAVE_BASE_URL}/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as WaveCheckoutSession;
}

/**
 * Vérifie la signature d'un webhook Wave.
 * Doc : https://docs.wave.com/webhook
 *
 * Header attendu : "Wave-Signature: t={timestamp},v1={signature}"
 * signature = HMAC-SHA256(timestamp + rawBody, webhookSecret), en hex.
 *
 * IMPORTANT : rawBody doit être la chaîne brute exacte reçue (ne PAS parser
 * en JSON puis re-stringify, sinon la signature ne correspondra jamais).
 */
export function verifyWaveWebhookSignature(
  rawBody: string,
  waveSignatureHeader: string | null,
  webhookSecret: string
): boolean {
  if (!waveSignatureHeader || !webhookSecret) return false;

  const parts = waveSignatureHeader.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const timestamp = timestampPart?.split("=")[1];
  const signatures = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3)); // enlève "v1="

  if (!timestamp || signatures.length === 0) return false;

  // Anti-rejeu : Wave rejette au-delà de 5 min de décalage, on fait pareil.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(nowSeconds - ts) > 5 * 60) {
    return false;
  }

  const payload = timestamp + rawBody;
  const computed = crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex");

  // Comparaison à temps constant pour éviter les attaques par timing.
  return signatures.some((sig) => {
    try {
      const a = Buffer.from(sig, "hex");
      const b = Buffer.from(computed, "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}
