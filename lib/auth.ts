import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseServer";

export type Role = "admin" | "vendor" | "client";

export interface SessionPayload {
  id: string;
  role: Role;
  name: string;
  [key: string]: unknown;
}

const COOKIE_NAME = "session";

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // Pas de valeur de secours : mieux vaut planter au démarrage que de
    // signer des sessions avec un secret prévisible en production.
    throw new Error("SESSION_SECRET is required (aucune valeur de secours autorisée).");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());

  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  let payload: SessionPayload;
  try {
    const verified = await jwtVerify(token, secretKey());
    payload = verified.payload as unknown as SessionPayload;
  } catch {
    return null;
  }

  // Un JWT valide ne suffit plus : pour un vendeur, on revérifie en base
  // qu'il est toujours actif. Sans ça, un vendeur désactivé/supprimé par
  // un admin garde un accès complet jusqu'à expiration du cookie (30 jours).
  // Ce coût (une requête DB par appel de getSession) est volontairement
  // accepté : la révocation immédiate prime sur la latence ici.
  if (payload.role === "vendor") {
    const db = supabaseAdmin();
    const { data: vendor, error } = await db
      .from("vendors")
      .select("is_active")
      .eq("id", payload.id)
      .maybeSingle();

    if (error || !vendor || vendor.is_active === false) {
      return null;
    }
  }

  return payload;
}

export async function destroySession() {
  cookies().delete(COOKIE_NAME);
}
