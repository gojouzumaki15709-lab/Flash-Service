import crypto from "crypto";

// ------------------------------------------------------------
// Chiffrement au repos des secrets sensibles stockés en base
// (clé API Wave, webhook_secret). AES-256-GCM :
//   - authentifié (une altération de l'octet chiffré est détectée)
//   - IV aléatoire à chaque appel, donc deux chiffrements du même
//     secret ne produisent jamais le même texte chiffré
//
// Format stocké : "v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
// Le préfixe "v1:" permet de distinguer une valeur déjà chiffrée
// d'une ancienne valeur en clair (utile pendant la migration des
// données existantes, voir scripts/encrypt-existing-secrets.mjs).
// ------------------------------------------------------------

const ALGO = "aes-256-gcm";
const PREFIX = "v1:";

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    // Pas de valeur par défaut : comme SESSION_SECRET, on refuse de
    // démarrer plutôt que de stocker des secrets en clair silencieusement.
    throw new Error(
      "ENCRYPTION_KEY is required (aucune valeur de secours autorisée). " +
        "Génère-la avec : node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  // On accepte soit 64 caractères hex, soit une chaîne base64, tant
  // qu'elle donne exactement 32 octets (AES-256).
  const asHex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (asHex.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY doit correspondre à exactement 32 octets (256 bits), reçu ${asHex.length} octets.`
    );
  }
  return asHex;
}

/** Chiffre une chaîne en clair. Retourne null si l'entrée est null/undefined/vide. */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = crypto.randomBytes(12); // 96 bits, recommandé pour GCM
  const cipher = crypto.createCipheriv(ALGO, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

/**
 * Déchiffre une valeur produite par encryptSecret(). Retourne null si
 * l'entrée est null/undefined/vide.
 *
 * Compatibilité transitoire : si la valeur ne commence pas par "v1:",
 * elle est considérée comme une ancienne valeur stockée en clair
 * (avant migration) et renvoyée telle quelle, avec un avertissement.
 * Une fois `scripts/encrypt-existing-secrets.mjs` exécuté sur toutes
 * les lignes existantes, ce cas ne devrait plus jamais se produire —
 * si le warning apparaît en prod après la migration, c'est le signe
 * qu'une donnée a été insérée en contournant les routes API.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === "") return null;

  if (!stored.startsWith(PREFIX)) {
    console.warn(
      "[crypto] Valeur non chiffrée détectée (préfixe 'v1:' absent). " +
        "As-tu bien exécuté scripts/encrypt-existing-secrets.mjs ?"
    );
    return stored;
  }

  const [ivHex, authTagHex, ciphertextHex] = stored.slice(PREFIX.length).split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Format de secret chiffré invalide (attendu v1:<iv>:<tag>:<ciphertext>).");
  }

  const decipher = crypto.createDecipheriv(ALGO, encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
