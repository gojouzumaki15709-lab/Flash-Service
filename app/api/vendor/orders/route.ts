import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

const DEBT_LIMIT = 1000;

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

  // 3. Déterminer si le paiement est en liquide (dans ce cas, la commande
  //    reste "pending" tant que le vendeur n'a pas confirmé quantité + somme reçue)
  let isCash = false;
  if (paymentMethodId) {
    const { data: pm } = await db.from("payment_methods").select("type").eq("id", paymentMethodId).single();
    isCash = pm?.type === "cash";
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
  //    - wave / dette -> "confirmed" immédiatement (paiement déjà effectif)
  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      client_id: session.id,
      vendor_id: vendorId,
      payment_method_id: paymentMethodId || null,
      is_debt: !!isDebt,
      total,
      status: isCash ? "pending" : "confirmed",
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

  return NextResponse.json({ ok: true, order });
}
