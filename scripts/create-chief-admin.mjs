// Usage : node scripts/create-chief-admin.mjs <nom> <mot_de_passe>
// Nécessite un fichier .env.local avec NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.
// Crée un compte admin avec is_chief = true. À utiliser une seule fois pour
// désigner le premier admin en chef (bootstrap) — ensuite, seul le chef en
// poste voit/gère la liste des admins depuis le panneau (aucun autre admin
// ne peut se promouvoir chef depuis l'UI). Si un chef existe déjà, ce script
// le signale au lieu d'en créer un second (un seul chef à la fois).
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
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

const [, , name, password] = process.argv;
if (!name || !password) {
  console.error("Usage : node scripts/create-chief-admin.mjs <nom> <mot_de_passe>");
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: existingChief } = await supabase.from("admins").select("id, name, code").eq("is_chief", true).maybeSingle();
if (existingChief) {
  console.error(
    `Un admin en chef existe déjà : ${existingChief.name} (${existingChief.code}). ` +
      "Supprime-le d'abord (colonne is_chief) si tu veux vraiment le remplacer."
  );
  process.exit(1);
}

const password_hash = await bcrypt.hash(password, 10);

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
  ({ data, error } = await supabase
    .from("admins")
    .insert({ code, name, password_hash, is_chief: true })
    .select()
    .single());
  if (!error) break;
  const isUniqueViolation = error.code === "23505" || /duplicate key|unique constraint/i.test(error.message);
  if (!isUniqueViolation) break;
}

if (error) {
  console.error("Erreur :", error.message);
  process.exit(1);
}

console.log("✅ Admin EN CHEF créé :", data.code, "-", data.name);
console.log("   (code de connexion à communiquer avec le mot de passe)");
console.log("   Seul ce compte voit/gère la liste des admins et peut planifier le Flash day.");
