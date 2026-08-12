import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// GET -> statut Flash-points du client connecté.
// IMPORTANT : tant que flash_unlocked = false, on ne renvoie AUCUNE
// information de progression (pas de "il te manque X jours") : la
// fonctionnalité doit rester invisible pour un client qui n'a pas encore
// rempli la condition des 3 jours consécutifs.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data: client, error } = await db
    .from("clients")
    .select("flash_unlocked, flash_points, flash_points_peak")
    .eq("id", session.id)
    .maybeSingle();

  if (error || !client) return NextResponse.json({ error: "Client introuvable." }, { status: 500 });

  if (!client.flash_unlocked) {
    return NextResponse.json({ unlocked: false });
  }

  const creditLimit =
    client.flash_points_peak < 100
      ? 0
      : client.flash_points < 20
      ? 0
      : client.flash_points <= 100
      ? 1000
      : client.flash_points <= 150
      ? 1500
      : 2000;

  const { data: activeCredits } = await db
    .from("flash_credits")
    .select("amount")
    .eq("client_id", session.id)
    .in("status", ["pending_repayment", "repayment_pending_confirmation"]);

  const currentDebt = (activeCredits || []).reduce((sum, c) => sum + Number(c.amount), 0);

  return NextResponse.json({
    unlocked: true,
    points: client.flash_points,
    creditAvailable: client.flash_points >= 10 && creditLimit > 0,
    creditLimit,
    currentDebt,
    remainingCredit: Math.max(0, creditLimit - currentDebt),
  });
}
