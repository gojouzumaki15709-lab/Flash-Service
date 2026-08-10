import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET -> liste les commandes en attente de confirmation pour le vendeur connecté
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "vendor") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("orders")
    .select(
      "id, total, created_at, client:clients(name, phone), payment_method:payment_methods(type, label), items:order_items(id, quantity, unit_price, product:products(id, name))"
    )
    .eq("vendor_id", session.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data });
}

function errorMessageFor(code: string): { message: string; status: number } {
  if (code === "ORDER_NOT_FOUND") return { message: "Commande introuvable.", status: 404 };
  if (code === "ORDER_NOT_PENDING") return { message: "Cette commande n'est plus en attente.", status: 400 };
  if (code === "WAVE_API_ORDER_CANNOT_BE_MANUALLY_CONFIRMED")
    return {
      message: "Cette commande est payée via Wave (API) : elle ne peut être confirmée que par Wave, pas manuellement.",
      status: 400,
    };
  if (code === "INSUFFICIENT_AMOUNT_RECEIVED")
    return { message: "La somme reçue est inférieure au total de la commande.", status: 400 };
  return { message: "Erreur lors de la confirmation.", status: 500 };
}

// PATCH body: { orderId, action: "confirm" | "reject", cashAmountReceived?, items?: [{ orderItemId, quantity }] }
// - confirm : enregistre la quantité réellement remise (peut être <= quantité commandée) et la somme reçue.
//             Si le client a finalement pris moins que commandé, la différence est restituée au stock.
// - reject  : annule la commande et restitue tout le stock réservé.
// Toute la logique (verrouillage de la commande, restitution du stock,
// vérification du montant reçu, blocage des commandes Wave API) est
// désormais atomique côté PostgreSQL — voir supabase/migration_hardening.sql.
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

  if (action === "reject") {
    const { error } = await db.rpc("reject_vendor_order_atomic", {
      p_order_id: orderId,
      p_vendor_id: session.id,
    });
    if (error) {
      const code = (error.message || "").split(":")[0] || "UNKNOWN";
      const { message, status } = errorMessageFor(code);
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ ok: true });
  }

  // action === "confirm"
  const cleanItems = Array.isArray(items)
    ? items
        .filter((it: any) => it?.orderItemId)
        .map((it: any) => ({ order_item_id: it.orderItemId, quantity: Math.max(0, Number(it.quantity) || 0) }))
    : [];

  const amountReceived =
    cashAmountReceived != null && cashAmountReceived !== "" ? Number(cashAmountReceived) : null;
  if (amountReceived != null && (!Number.isFinite(amountReceived) || amountReceived < 0)) {
    return NextResponse.json({ error: "Somme reçue invalide." }, { status: 400 });
  }

  const { error } = await db.rpc("confirm_vendor_order_atomic", {
    p_order_id: orderId,
    p_vendor_id: session.id,
    p_items: cleanItems,
    p_cash_amount_received: amountReceived,
  });

  if (error) {
    const code = (error.message || "").split(":")[0] || "UNKNOWN";
    const { message, status } = errorMessageFor(code);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
