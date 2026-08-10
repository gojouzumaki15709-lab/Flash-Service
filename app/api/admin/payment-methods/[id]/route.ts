import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";

async function requireAdmin() {
  const session = await getSession();
  return session && session.role === "admin" ? session : null;
}

// body: { isActive?, merchantLink?, iconUrl?, apiKey?, webhookSecret? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const { isActive, merchantLink, iconUrl, apiKey, webhookSecret } = await req.json();
  const db = supabaseAdmin();

  const update: Record<string, unknown> = {};
  if (isActive !== undefined) update.is_active = isActive;
  if (merchantLink !== undefined) update.merchant_link = merchantLink;
  if (iconUrl !== undefined) update.icon_url = iconUrl;

  // apiKey et webhookSecret sont un vrai changement de secret (rotation) :
  // on trace la date pour pouvoir vérifier depuis l'admin que la rotation a
  // bien eu lieu après une fuite, plutôt que de devoir aller lire la DB.
  const isRotation = apiKey !== undefined || webhookSecret !== undefined;

  if (apiKey !== undefined) {
    update.api_key_encrypted = encryptSecret(apiKey);
  }

  if (webhookSecret !== undefined) {
    // BUG corrigé : l'ancien code faisait `update.config = { webhook_secret: ... }`,
    // ce qui écrasait silencieusement tout autre champ déjà présent dans
    // `config`. On lit d'abord la valeur existante et on fusionne.
    const { data: current, error: readError } = await db
      .from("payment_methods")
      .select("config")
      .eq("id", params.id)
      .maybeSingle();
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
    update.config = { ...(current?.config as Record<string, unknown> | null), webhook_secret: encryptSecret(webhookSecret) };
  }

  if (isRotation) {
    update.secret_rotated_at = new Date().toISOString();
  }

  const { error } = await db.from("payment_methods").update(update).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const db = supabaseAdmin();
  const { error } = await db.from("payment_methods").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
