import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";
import { createWaveCheckoutSession } from "@/lib/wave";
import { decryptSecret } from "@/lib/crypto";

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
  if (code === "UNSUPPORTED_PAYMENT_METHOD")
    return { message: "Moyen de paiement invalide : choisis liquide ou Wave.", status: 400 };
  if (code === "INVALID_QUANTITY") return { message: "Quantité invalide.", status: 400 };
  if (code === "EMPTY_ORDER") return { message: "Commande vide.", status: 400 };
  if (code === "CLIENT_ROOM_REQUIRED") return { message: "Indique ta chambre (ex: 12-67 ou B-67).", status: 400 };
  if (code.startsWith("INSUFFICIENT_STOCK")) return { message: "Stock insuffisant pour un ou plusieurs produits.", status: 400 };
  return { message: "Erreur lors de la création de la commande.", status: 500 };
}

// Bâtiment : "1" à "16" (numérotés) ou "A" à "Z" (lettrés). Chambre : 1 à 96.
// Format attendu : "<bâtiment>-<chambre>", ex: "12-67" ou "B-67".
const ROOM_FORMAT = /^([A-Z]|[1-9]|1[0-6])-([1-9]|[1-8][0-9]|9[0-6])$/;

// body: { vendorId, items: [{ productId, quantity }], paymentMethodId, room }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Connecte-toi en tant que client." }, { status: 401 });
  }

  const { vendorId, items, paymentMethodId, room } = await req.json();
  if (!vendorId || !items?.length) {
    return NextResponse.json({ error: "Commande vide." }, { status: 400 });
  }
  if (!paymentMethodId) {
    return NextResponse.json({ error: "Choisis un mode de paiement." }, { status: 400 });
  }

  const clientRoom = typeof room === "string" ? room.trim().toUpperCase() : "";
  if (!clientRoom || !ROOM_FORMAT.test(clientRoom)) {
    return NextResponse.json({ error: "Indique ta chambre au format bâtiment-chambre (ex: 12-67 ou B-67)." }, { status: 400 });
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

  // Toute la vérification (vendeur ouvert, stock, type de paiement) et
  // l'écriture (commande + lignes + décrément du stock) se font en UNE
  // SEULE transaction PostgreSQL côté serveur. Voir create_order_atomic
  // dans supabase/migration_remove_debt_system.sql — ceci remplace
  // l'ancienne suite SELECT/UPDATE en JS qui était vulnérable aux races
  // conditions et pouvait confirmer une commande sans paiement vérifié.
  const { data: result, error: rpcError } = await db.rpc("create_order_atomic", {
    p_client_id: session.id,
    p_vendor_id: vendorId,
    p_items: cleanItems,
    p_payment_method_id: paymentMethodId,
    p_client_room: clientRoom,
  });

  if (rpcError || !result) {
    const code = (rpcError?.message || "").split(":")[0] || "UNKNOWN";
    const { message, status } = errorMessageFor(code);
    return NextResponse.json({ error: message }, { status });
  }

  const orderId = result.order_id as string;
  const status = result.status as string;
  const paymentType = result.payment_type as string | null;
  // create_order_atomic() renvoie la valeur brute de payment_methods.api_key_encrypted
  // (chiffrée depuis la migration crypto). On la déchiffre ici, côté serveur
  // uniquement — elle n'est jamais renvoyée telle quelle au client.
  const apiKey = decryptSecret(result.api_key as string | null);
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
