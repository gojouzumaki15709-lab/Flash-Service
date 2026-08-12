import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET -> historique des achats à crédit du client connecté.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("flash_credits")
    .select(
      "id, amount, status, points_spent, created_at, repaid_at, vendor:vendors(name), order:orders(id, created_at, client_room)"
    )
    .eq("client_id", session.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ credits: data || [] });
}

function errorMessageFor(code: string): { message: string; status: number } {
  if (code === "INSUFFICIENT_FLASH_POINTS") return { message: "Tu n'as pas assez de Flash-points (10 requis).", status: 400 };
  if (code === "CREDIT_NOT_UNLOCKED") return { message: "L'achat à crédit n'est pas (ou plus) disponible pour toi.", status: 400 };
  if (code === "DEBT_LIMIT_EXCEEDED") return { message: "Ce crédit dépasserait ta dette maximale autorisée.", status: 400 };
  if (code === "VENDOR_CLOSED") return { message: "Ce vendeur est fermé.", status: 400 };
  if (code === "VENDOR_INACTIVE") return { message: "Ce vendeur n'est plus disponible.", status: 400 };
  if (code === "EMPTY_ORDER") return { message: "Commande vide.", status: 400 };
  if (code === "CLIENT_ROOM_REQUIRED") return { message: "Indique ta chambre (ex: 12-67 ou B-67).", status: 400 };
  if (code === "INVALID_QUANTITY") return { message: "Quantité invalide.", status: 400 };
  if (code.startsWith("INSUFFICIENT_STOCK")) return { message: "Stock insuffisant pour un ou plusieurs produits.", status: 400 };
  return { message: "Erreur lors de la demande de crédit.", status: 500 };
}

// body: { vendorId, items: [{ productId, quantity }], room }
// Achat à crédit : payé plus tard en liquide (confirmé par un vendeur) ou
// directement sur le site (voir /api/client/credit/repay). Coûte 10
// Flash-points, disponible uniquement si le crédit a déjà été débloqué
// (>= 100 points un jour) et que le solde de points et le plafond de dette
// cumulée le permettent (voir request_flash_credit_atomic).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Connecte-toi en tant que client." }, { status: 401 });
  }

  const { vendorId, items, room } = await req.json();
  if (!vendorId || !items?.length) {
    return NextResponse.json({ error: "Commande vide." }, { status: 400 });
  }

  const clientRoom = typeof room === "string" ? room.trim().toUpperCase() : "";
  if (!clientRoom) {
    return NextResponse.json({ error: "Indique ta chambre." }, { status: 400 });
  }

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
  const { data: result, error } = await db.rpc("request_flash_credit_atomic", {
    p_client_id: session.id,
    p_vendor_id: vendorId,
    p_items: cleanItems,
    p_client_room: clientRoom,
  });

  if (error || !result) {
    const code = (error?.message || "").split(":")[0] || "UNKNOWN";
    const { message, status } = errorMessageFor(code);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true, credit: result });
}
