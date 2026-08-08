import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db.from("orders").select("client_id, total, client:clients(name, phone)");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byClient = new Map<string, { name: string; phone: string; orders: number; total: number }>();
  for (const row of data || []) {
    const client = row.client as unknown as { name: string; phone: string };
    const entry = byClient.get(row.client_id) || { name: client?.name, phone: client?.phone, orders: 0, total: 0 };
    entry.orders += 1;
    entry.total += Number(row.total) || 0;
    byClient.set(row.client_id, entry);
  }

  const ranked = Array.from(byClient.values()).sort((a, b) => b.orders - a.orders);
  return NextResponse.json({ clients: ranked });
}
