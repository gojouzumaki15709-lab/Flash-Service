import { randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Identifiants de connexion générés par le système pour les admins et les
// vendeurs (les clients gardent leur "username" libre choisi à l'inscription).
// Format : préfixe de 3 lettres + 6 caractères aléatoires, ex. ADMK7QX9F.
// L'admin n'a jamais besoin d'inventer ni de saisir ce code : il est généré
// à la création du compte, à communiquer tel quel au vendeur/admin concerné.
//
// Ces codes ne sont volontairement PAS séquentiels : un compte ADM000001
// laisse deviner qu'il existe un ADM000002, ADM000003, etc., et un
// attaquant qui connaît un seul code vendeur peut balayer tout l'espace en
// quelques milliers de requêtes. Avec 6 caractères tirés d'un alphabet de
// 32 symboles (~30 bits d'entropie, ~1 milliard de combinaisons), deviner
// un code au hasard reste impraticable en pratique (rate limiting sur le
// login en plus), tout en restant court à dicter/recopier.
const CODE_LENGTH = 6;

// Alphabet façon "Crockford base32" : que des majuscules/chiffres, sans
// 0/O, 1/I/L ni lettres qui se confondent facilement à l'oral/à l'écrit
// (pas de voyelles doublées non plus). Choisi pour rester dictable au
// téléphone tout en gardant une bonne entropie par caractère (5 bits).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

type CodeTable = "admins" | "vendors";

const PREFIX: Record<CodeTable, string> = {
  admins: "ADM",
  vendors: "VEN",
};

function randomCode(prefix: string): string {
  let suffix = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${prefix}${suffix}`;
}

// Insère une ligne dans `table` avec un code aléatoire non devinable, en
// réessayant avec un nouveau tirage en cas de collision (extrêmement rare
// vu l'espace de tirage, mais on ne laisse jamais la création échouer pour
// ça). `buildRow` reçoit le code choisi et doit renvoyer le reste des
// colonnes.
export async function insertWithGeneratedCode<T>(
  db: SupabaseClient,
  table: CodeTable,
  buildRow: (code: string) => Record<string, unknown>,
  maxAttempts = 5
): Promise<{ data: T | null; error: { message: string } | null; code: string | null }> {
  let lastError: { message: string } | null = null;
  const prefix = PREFIX[table];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = randomCode(prefix);
    const { data, error } = await db.from(table).insert(buildRow(code)).select().single();

    if (!error) return { data: data as T, error: null, code };

    // 23505 = violation de contrainte unique Postgres : collision (quasi
    // impossible statistiquement). On retire simplement un nouveau code
    // plutôt que de faire échouer la création du compte.
    const isUniqueViolation =
      (error as { code?: string }).code === "23505" || /duplicate key|unique constraint/i.test(error.message);
    if (!isUniqueViolation) return { data: null, error, code: null };
    lastError = error;
  }

  return { data: null, error: lastError, code: null };
}
