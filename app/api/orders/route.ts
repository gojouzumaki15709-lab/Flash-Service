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

  const db = supabaseAdmin();

  // 1. Vérifier le vendeur est ouvert
  const { data: vendor } = await db.from("vendors").select("is_open").eq("id", vendorId).single();
  if (!vendor?.is_open) {
    return NextResponse.json({ error: "Ce vendeur est fermé." }, { status: 400 });
  }

  // 2. Charger le stock + prix pour chaque produit demandé et vérifier la disponibilité
  const productIds = items.map((i: any) => i.productId);
  const { data: stockRows } = await db
    .from("vendor_stock")
    .select("id, quantity, product_id, product:products(price, name)")
    .eq("vendor_id", vendorId)
    .in("product_id", productIds);

  let total = 0;
  const orderItems: { product_id: string; quantity: number; unit_price: number }[] = [];

  for (const item of items) {
    const row = stockRows?.find((s) => s.product_id === item.productId);
    const product = row?.product as unknown as { price: number; name: string } | undefined;
    if (!row || !product || row.quantity < item.quantity) {
      return NextResponse.json(
        { error: `Stock insuffisant pour ${product?.name || "un produit"}.` },
        { status: 400 }
      );
    }
    total += product.price * item.quantity;
    orderItems.push({ product_id: item.productId, quantity: item.quantity, unit_price: product.price });
  }

  // 3. Déterminer le type de paiement.
  //    - cash : commande "pending" tant que le vendeur n'a pas confirmé quantité + somme reçue.
  //    - wave : commande "pending" tant que Wave n'a pas confirmé le paiement via webhook.
  //    - autre / dette : "confirmed" immédiatement.
  let paymentType: string | null = null;
  let wavePaymentMethod: { id: string; api_key_encrypted: string | null; is_active: boolean } | null = null;
  if (paymentMethodId) {
    const { data: pm } = await db
      .from("payment_methods")
      .select("id, type, api_key_encrypted, is_active")
      .eq("id", paymentMethodId)
      .single();
    const pmData = pm as { id: string; type: string; api_key_encrypted: string | null; is_active: boolean } | null;
    paymentType = pmData?.type || null;
    if (paymentType === "wave" && pmData) {
      wavePaymentMethod = { id: pmData.id, api_key_encrypted: pmData.api_key_encrypted, is_active: pmData.is_active };
    }
  }
  const isCash = paymentType === "cash";
  const isWave = paymentType === "wave";

  if (isWave) {
    if (!wavePaymentMethod?.is_active) {
      return NextResponse.json({ error: "Le paiement Wave n'est pas disponible actuellement." }, { status: 400 });
    }
    if (!wavePaymentMethod.api_key_encrypted) {
      return NextResponse.json(
        { error: "Le paiement Wave n'est pas encore configuré (clé API manquante). Contacte l'admin." },
        { status: 400 }
      );
    }
  }

  // 4. Si paiement à crédit : vérifier le plafond de dette (1000, tous vendeurs confondus)
  if (isDebt) {
    const { data: debtView } = await db
      .from("client_current_debt")
      .select("total_debt")
      .eq("client_id", session.id)
      .maybeSingle();
    const currentDebt = debtView?.total_debt || 0;
    if (currentDebt + total > DEBT_LIMIT) {
      return NextResponse.json(
        {
          error: `Plafond de dette dépassé (max ${DEBT_LIMIT} FCFA). Dette actuelle : ${currentDebt} FCFA. Rembourse avant d'emprunter à nouveau.`,
        },
        { status: 400 }
      );
    }
  }

  // 5. Créer la commande
  //    - paiement liquide -> "pending" : le vendeur doit confirmer quantité prise + somme reçue
  //    - wave -> "pending" : confirmée seulement quand Wave notifie le paiement via webhook
  //    - dette / autre -> "confirmed" immédiatement (paiement déjà effectif)
  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      client_id: session.id,
      vendor_id: vendorId,
      payment_method_id: paymentMethodId || null,
      is_debt: !!isDebt,
      total,
      status: isCash || isWave ? "pending" : "confirmed",
    })
    .select()
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Erreur lors de la création de la commande." }, { status: 500 });
  }

  await db.from("order_items").insert(orderItems.map((i) => ({ ...i, order_id: order.id })));

  // 6. Décrémenter le stock (réservé tout de suite, même pour le liquide en attente,
  //    pour éviter qu'un autre client achète le même stock entre-temps)
  for (const item of items) {
    const row = stockRows?.find((s) => s.product_id === item.productId);
    if (row) {
      await db
        .from("vendor_stock")
        .update({ quantity: row.quantity - item.quantity, updated_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  }

  // 7. Si dette, enregistrer
  if (isDebt) {
    await db.from("debts").insert({ client_id: session.id, order_id: order.id, amount: total });
  }

  // 8. Si Wave : créer la session de paiement et renvoyer le lien de redirection.
  //    Si Wave échoue, on annule proprement la commande et on restitue le stock
  //    (le client n'a encore rien payé à ce stade).
  if (isWave && wavePaymentMethod) {
    const base = siteUrl(req);
    try {
      const waveSession = await createWaveCheckoutSession({
        apiKey: wavePaymentMethod.api_key_encrypted!,
        amount: total,
        clientReference: order.id,
        successUrl: `${base}/client?wave=success&order=${order.id}`,
        errorUrl: `${base}/client?wave=error&order=${order.id}`,
      });

      await db.from("orders").update({ wave_checkout_id: waveSession.id }).eq("id", order.id);

      return NextResponse.json({ ok: true, order, waveLaunchUrl: waveSession.wave_launch_url });
    } catch (err) {
      // Rollback : on restitue le stock réservé et on annule la commande.
      for (const item of items) {
        const row = stockRows?.find((s) => s.product_id === item.productId);
        if (row) {
          await db
            .from("vendor_stock")
            .update({ quantity: row.quantity, updated_at: new Date().toISOString() })
            .eq("id", row.id);
        }
      }
      await db.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      const errorMessage = err instanceof Error ? err.message : "Erreur inconnue.";
      return NextResponse.json(
        { error: `Impossible de démarrer le paiement Wave : ${errorMessage}` },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ ok: true, order });
}
