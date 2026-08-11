// Usage : node scripts/create-admin.mjs <nom> <mot_de_passe>
// Nécessite un fichier .env.local avec NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
// Le code de connexion (ADMxxxxxx, aléatoire et non devinable) est généré
// automatiquement par le script — pas besoin de l'inventer ni de vérifier
// qu'il est libre. Ce script ne sert plus qu'à créer le tout premier admin
// (bootstrap) : une fois connecté, un admin peut en créer d'autres depuis
// l'onglet "Admins" du panneau d'administration.
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { readFileSync } from "fs";

// Charge .env.local manuellement (pas de dépendance dotenv)
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

const [, , name, password] = process.argv;
if (!name || !password) {
  console.error("Usage : node scripts/create-admin.mjs <nom> <mot_de_passe>");
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const password_hash = await bcrypt.hash(password, 10);

// Même logique que lib/identifiers.ts (le script tourne hors de l'app Next,
// donc on la réécrit ici plutôt que de l'importer) : ADM + 6 caractères
// aléatoires tirés d'un alphabet sans ambiguïté (pas de 0/O, 1/I/L...).
// Codes non séquentiels et non devinables — voir le commentaire dans
// lib/identifiers.ts pour le détail du choix.
const PREFIX = "ADM";
const CODE_LENGTH = 6;
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomCode() {
  let suffix = "";
  for (let i = 0; i < CODE_LENGTH; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `${PREFIX}${suffix}`;
}

let data, error;
for (let attempt = 0; attempt < 5; attempt++) {
  const code = randomCode();
  ({ data, error } = await supabase.from("admins").insert({ code, name, password_hash }).select().single());
  if (!error) break;
  const isUniqueViolation = error.code === "23505" || /duplicate key|unique constraint/i.test(error.message);
  if (!isUniqueViolation) break;
}

if (error) {
  console.error("Erreur :", error.message);
  process.exit(1);
}

console.log("✅ Administrateur créé :", data.code, "-", data.name);
console.log("   (code de connexion à communiquer avec le mot de passe)");
