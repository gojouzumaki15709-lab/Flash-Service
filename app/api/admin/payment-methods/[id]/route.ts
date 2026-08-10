import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

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
  if (apiKey !== undefined) update.api_key_encrypted = apiKey;
  if (webhookSecret !== undefined) update.config = { webhook_secret: webhookSecret };

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
