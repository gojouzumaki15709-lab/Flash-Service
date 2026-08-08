// Usage : node scripts/create-admin.mjs <code> <nom> <mot_de_passe>
// Nécessite un fichier .env.local avec NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
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

const [, , code, name, password] = process.argv;
if (!code || !name || !password) {
  console.error("Usage : node scripts/create-admin.mjs <code> <nom> <mot_de_passe>");
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const password_hash = await bcrypt.hash(password, 10);

const { data, error } = await supabase.from("admins").insert({ code, name, password_hash }).select().single();

if (error) {
  console.error("Erreur :", error.message);
  process.exit(1);
}

console.log("✅ Administrateur créé :", data.code, "-", data.name);
