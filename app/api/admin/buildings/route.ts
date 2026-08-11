import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getSession } from "@/lib/auth";

// Tri "humain" : bâtiments numérotés 1 -> 16 d'abord, puis bâtiments
// lettrés A -> Z. Un tri alphabétique brut sur le texte ("1","10",
// "11"..."2"...) serait faux pour la partie numérique, donc on trie
// côté serveur après lecture plutôt qu'avec .order() sur la colonne.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db.from("buildings").select("id, name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sorted = (data || []).slice().sort((a, b) => {
    const na = Number(a.name);
    const nb = Number(b.name);
    const aIsNum = !Number.isNaN(na);
    const bIsNum = !Number.isNaN(nb);
    if (aIsNum && bIsNum) return na - nb;
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ buildings: sorted });
}
