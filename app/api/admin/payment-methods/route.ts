import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

export async function GET() {
  const db = supabaseAdmin();
  // ne jamais renvoyer api_key_encrypted au client
  const { data, error } = await db
    .from("payment_methods")
    .select("id, type, label, is_active, merchant_link, icon_url")
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ paymentMethods: data });
}

// body: { type, label, merchantLink, iconUrl, apiKey, webhookSecret }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const { type, label, merchantLink, iconUrl, apiKey, webhookSecret } = await req.json();
  if (!type || !label) {
    return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("payment_methods")
    .insert({
      type,
      label,
      merchant_link: merchantLink || null,
      icon_url: iconUrl || null,
      api_key_encrypted: apiKey || null, // TODO: chiffrer avant stockage en production
      config: webhookSecret ? { webhook_secret: webhookSecret } : {},
    })
    .select("id, type, label, is_active, merchant_link, icon_url")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, paymentMethod: data });
}
