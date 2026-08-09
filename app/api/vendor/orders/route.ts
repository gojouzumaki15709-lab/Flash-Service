import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET -> liste les commandes liquide en attente de confirmation pour le vendeur connecté
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("orders")
    .select(
      "id, total, created_at, client:clients(name, phone), items:order_items(id, quantity, unit_price, product:products(id, name))"
    )
    .eq("vendor_id", session.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data });
}

// PATCH body: { orderId, action: "confirm" | "reject", cashAmountReceived?, items?: [{ orderItemId, quantity }] }
// - confirm : enregistre la quantité réellement remise (peut être <= quantité commandée) et la somme reçue.
//             Si le client a finalement pris moins que commandé, la différence est restituée au stock.
// - reject  : annule la commande et restitue tout le stock réservé.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { orderId, action, cashAmountReceived, items } = await req.json();
  if (!orderId || !["confirm", "reject"].includes(action)) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Vérifier que la commande appartient bien à ce vendeur et est encore en attente
  const { data: order } = await db
    .from("orders")
    .select("id, vendor_id, status")
    .eq("id", orderId)
    .single();

  if (!order || order.vendor_id !== session.id) {
    return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  }
  if (order.status !== "pending") {
    return NextResponse.json({ error: "Cette commande n'est plus en attente." }, { status: 400 });
  }

  const { data: orderItems } = await db
    .from("order_items")
    .select("id, product_id, quantity, unit_price")
    .eq("order_id", orderId);

  if (action === "reject") {
    // Restituer tout le stock réservé (lecture + écriture manuelle, comme dans le reste du code)
    for (const item of orderItems || []) {
      const { data: stockRow } = await db
        .from("vendor_stock")
        .select("id, quantity")
        .eq("vendor_id", session.id)
        .eq("product_id", item.product_id)
        .maybeSingle();
      if (stockRow) {
        await db
          .from("vendor_stock")
          .update({ quantity: stockRow.quantity + item.quantity, updated_at: new Date().toISOString() })
          .eq("id", stockRow.id);
      }
    }

    await db.from("orders").update({ status: "cancelled" }).eq("id", orderId);
    return NextResponse.json({ ok: true });
  }

  // action === "confirm"
  const confirmedQuantities: Record<string, number> = {};
  for (const it of items || []) {
    confirmedQuantities[it.orderItemId] = Math.max(0, Number(it.quantity) || 0);
  }

  let newTotal = 0;
  for (const item of orderItems || []) {
    const confirmedQty = confirmedQuantities[item.id] ?? item.quantity;
    const finalQty = Math.min(confirmedQty, item.quantity); // jamais plus que ce qui a été réservé
    const diff = item.quantity - finalQty; // quantité non prise -> à restituer au stock

    if (diff > 0) {
      const { data: stockRow } = await db
        .from("vendor_stock")
        .select("id, quantity")
        .eq("vendor_id", session.id)
        .eq("product_id", item.product_id)
        .maybeSingle();
      if (stockRow) {
        await db
          .from("vendor_stock")
          .update({ quantity: stockRow.quantity + diff, updated_at: new Date().toISOString() })
          .eq("id", stockRow.id);
      }
    }

    // On garde "quantity" intacte (ce qui a été commandé à l'origine, pour
    // la traçabilité) et on enregistre séparément ce qui a été réellement remis.
    await db.from("order_items").update({ quantity_taken: finalQty }).eq("id", item.id);

    newTotal += finalQty * item.unit_price;
  }

  const amountReceived = cashAmountReceived != null && cashAmountReceived !== "" ? Number(cashAmountReceived) : newTotal;

  await db
    .from("orders")
    .update({
      status: "confirmed",
      confirmed_by_vendor: true,
      cash_amount_received: amountReceived,
      total: newTotal,
    })
    .eq("id", orderId);

  return NextResponse.json({ ok: true });
}
