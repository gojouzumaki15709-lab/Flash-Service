// Usage : node scripts/encrypt-existing-secrets.mjs
// Nécessite un .env.local avec NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ET ENCRYPTION_KEY (voir .env.example).
//
// À exécuter UNE SEULE FOIS, juste après avoir déployé le code qui utilise
// lib/crypto.ts (encryptSecret/decryptSecret), pour chiffrer les valeurs
// déjà présentes en base (créées avant la migration, donc en clair).
//
// C'est un script à part (pas de l'API) : il tourne côté serveur, avec la
// clé service_role, une seule fois, et n'expose jamais rien au client.
//
// Idempotent : les valeurs déjà chiffrées (préfixe "v1:") sont ignorées,
// donc tu peux le relancer sans risque si besoin.

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { readFileSync } from "fs";

function loadEnv() {
  try {
    const content = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([^=#]+)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim();
    }
  } catch {
    console.error("Impossible de lire .env.local — crée-le d'abord (voir .env.example).");
    process.exit(1);
  }
}
loadEnv();

const ALGO = "aes-256-gcm";
const PREFIX = "v1:";

function encryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    console.error("ENCRYPTION_KEY manquant dans .env.local.");
    process.exit(1);
  }
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    console.error(`ENCRYPTION_KEY doit faire 32 octets, reçu ${buf.length}.`);
    process.exit(1);
  }
  return buf;
}

function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

function isAlreadyEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: rows, error } = await supabase
  .from("payment_methods")
  .select("id, api_key_encrypted, config");

if (error) {
  console.error("Erreur de lecture :", error.message);
  process.exit(1);
}

let updated = 0;
let skipped = 0;

for (const row of rows) {
  const update = {};

  if (row.api_key_encrypted && !isAlreadyEncrypted(row.api_key_encrypted)) {
    update.api_key_encrypted = encryptSecret(row.api_key_encrypted);
  }

  const webhookSecret = row.config?.webhook_secret;
  if (webhookSecret && !isAlreadyEncrypted(webhookSecret)) {
    update.config = { ...row.config, webhook_secret: encryptSecret(webhookSecret) };
  }

  if (Object.keys(update).length === 0) {
    skipped++;
    continue;
  }

  const { error: updateError } = await supabase.from("payment_methods").update(update).eq("id", row.id);
  if (updateError) {
    console.error(`❌ Échec pour ${row.id} :`, updateError.message);
    continue;
  }
  updated++;
  console.log(`✅ Chiffré : ${row.id}`);
}

console.log(`\nTerminé. ${updated} ligne(s) chiffrée(s), ${skipped} déjà en ordre.`);
