import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";
import { createWaveCheckoutSession } from "@/lib/wave";

const DEBT_LIMIT = 1000;

function siteUrl(req: NextRequest) {
  // En prod sur Vercel, NEXT_PUBLIC_SITE_URL doit être défini (ex: https://flash-service.vercel.app).
  // En dev local, on retombe sur l'origine de la requête.
  return process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
}

// Messages d'erreur renvoyés par create_order_atomic (voir
// supabase/migration_hardening.sql) traduits pour l'utilisateur.
function errorMessageFor(code: string): { message: string; status: number } {
  if (code === "VENDOR_CLOSED") return { message: "Ce vendeur est fermé.", status: 400 };
  if (code === "PAYMENT_METHOD_NOT_FOUND") return { message: "Moyen de paiement introuvable.", status: 400 };
  if (code === "PAYMENT_METHOD_INACTIVE") return { message: "Ce moyen de paiement n'est plus disponible.", status: 400 };
  if (code === "DEBT_CANNOT_HAVE_PAYMENT_METHOD")
    return { message: "Une commande à crédit ne peut pas avoir de moyen de paiement.", status: 400 };
  if (code === "UNSUPPORTED_PAYMENT_METHOD")
    return { message: "Moyen de paiement invalide : choisis liquide, Wave, ou paiement à crédit.", status: 400 };
  if (code === "INVALID_QUANTITY") return { message: "Quantité invalide.", status: 400 };
  if (code === "DEBT_LIMIT_EXCEEDED")
    return { message: `Plafond de dette dépassé (max ${DEBT_LIMIT} FCFA). Rembourse avant d'emprunter à nouveau.`, status: 400 };
  if (code === "EMPTY_ORDER") return { message: "Commande vide.", status: 400 };
  if (code.startsWith("INSUFFICIENT_STOCK")) return { message: "Stock insuffisant pour un ou plusieurs produits.", status: 400 };
  return { message: "Erreur lors de la création de la commande.", status: 500 };
}

// body: { vendorId, items: [{ productId, quantity }], paymentMethodId, isDebt }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Connecte-toi en tant que client." }, { status: 401 });
  }

  const { vendorId, items, paymentMethodId, isDebt } = await req.json();
  if (!vendorId || !items?.length) {
    return NextResponse.json({ error: "Commande vide." }, { status: 400 });
  }

  // Validation basique des entrées avant même d'appeler la DB.
  const cleanItems: { product_id: string; quantity: number }[] = [];
  for (const item of items) {
    const productId = item?.productId;
    const quantity = Number(item?.quantity);
    if (typeof productId !== "string" || !productId) {
      return NextResponse.json({ error: "Article invalide." }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Quantité invalide." }, { status: 400 });
    }
    cleanItems.push({ product_id: productId, quantity });
  }

  const db = supabaseAdmin();

  // Toute la vérification (vendeur ouvert, stock, plafond de dette,
  // type de paiement) et l'écriture (commande + lignes + décrément du
  // stock + dette éventuelle) se font en UNE SEULE transaction
  // PostgreSQL côté serveur. Voir create_order_atomic dans
  // supabase/migration_hardening.sql — ceci remplace l'ancienne suite
  // SELECT/UPDATE en JS qui était vulnérable aux races conditions et
  // pouvait confirmer une commande sans paiement vérifié.
  const { data: result, error: rpcError } = await db.rpc("create_order_atomic", {
    p_client_id: session.id,
    p_vendor_id: vendorId,
    p_items: cleanItems,
    p_payment_method_id: paymentMethodId || null,
    p_is_debt: !!isDebt,
    p_debt_limit: DEBT_LIMIT,
  });

  if (rpcError || !result) {
    const code = (rpcError?.message || "").split(":")[0] || "UNKNOWN";
    const { message, status } = errorMessageFor(code);
    return NextResponse.json({ error: message }, { status });
  }

  const orderId = result.order_id as string;
  const status = result.status as string;
  const paymentType = result.payment_type as string | null;
  const apiKey = result.api_key as string | null;
  const merchantLink = result.merchant_link as string | null;

  const isWaveApiMode = paymentType === "wave" && !!apiKey;
  const isWaveLinkMode = paymentType === "wave" && !apiKey;

  if (isWaveApiMode) {
    const base = siteUrl(req);
    try {
      const waveSession = await createWaveCheckoutSession({
        apiKey: apiKey!,
        amount: result.total,
        clientReference: orderId,
        successUrl: `${base}/client?wave=success&order=${orderId}`,
        errorUrl: `${base}/client?wave=error&order=${orderId}`,
      });

      await db.from("orders").update({ wave_checkout_id: waveSession.id }).eq("id", orderId);

      return NextResponse.json({
        ok: true,
        order: { id: orderId, status, total: result.total },
        waveLaunchUrl: waveSession.wave_launch_url,
        waveMode: "api",
      });
    } catch (err) {
      // Rollback atomique : restitue le stock réservé et annule la commande
      // (le client n'a encore rien payé à ce stade).
      await db.rpc("cancel_pending_order_atomic", { p_order_id: orderId });
      const errorMessage = err instanceof Error ? err.message : "Erreur inconnue.";
      return NextResponse.json(
        { error: `Impossible de démarrer le paiement Wave : ${errorMessage}` },
        { status: 502 }
      );
    }
  }

  if (isWaveLinkMode) {
    return NextResponse.json({
      ok: true,
      order: { id: orderId, status, total: result.total },
      waveLaunchUrl: merchantLink,
      waveMode: "link",
    });
  }

  return NextResponse.json({ ok: true, order: { id: orderId, status, total: result.total } });
}
