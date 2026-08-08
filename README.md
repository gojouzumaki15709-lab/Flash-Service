# Sucrerie App

Application de vente de sucreries/boissons — admins, vendeurs (par bâtiment), clients.

## 1. Base de données (Supabase)

1. Dans ton projet Supabase → **SQL Editor** → **New query**.
2. Colle tout le contenu de `supabase/schema.sql` et clique **Run**.
3. Ça crée toutes les tables + pré-remplit les bâtiments A1 → Z16.

## 2. Configuration locale

```bash
cp .env.example .env.local
```

Remplis `.env.local` avec :
- `NEXT_PUBLIC_SUPABASE_URL` (Project Settings > API > Project URL)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings > API > anon public)
- `SUPABASE_SERVICE_ROLE_KEY` (Project Settings > API > service_role — secret !)
- `SESSION_SECRET` (une longue chaîne aléatoire, ex: générée avec `openssl rand -hex 32`)

## 3. Installer et lancer en local

```bash
npm install
node scripts/create-admin.mjs monCode "Mon Nom" monMotDePasse
npm run dev
```

Ouvre http://localhost:3000 — connecte-toi en tant qu'admin avec le code créé.

## 4. Mettre le code sur GitHub

```bash
git init
git add .
git commit -m "Premier commit"
```

Sur github.com : crée un nouveau repository (vide, sans README), puis :

```bash
git remote add origin https://github.com/TON_USERNAME/sucrerie-app.git
git branch -M main
git push -u origin main
```

## 5. Déployer sur Vercel

1. Sur vercel.com → **Add New > Project** → importe ton repo GitHub `sucrerie-app`.
2. Dans **Environment Variables**, ajoute les 4 mêmes variables que dans `.env.local`.
3. Clique **Deploy**.
4. Tu obtiens un lien public du type `https://sucrerie-app.vercel.app` — partageable avec n'importe qui.

## Notes importantes

- Seul un administrateur peut créer/supprimer un compte vendeur (onglet "Vendeurs" du dashboard admin).
- Seul un administrateur crée les produits du catalogue (prix fixe pour tous les vendeurs).
- Les modes de paiement (Wave, Orange Money, Liquide...) sont gérés dynamiquement depuis l'onglet "Paiements" — tu peux désactiver/supprimer un compte marchand problématique et en ajouter un autre sans toucher au code.
- Le plafond de dette (1000 FCFA par client, tous vendeurs confondus) est appliqué automatiquement à chaque commande.
- **Prochaine étape à intégrer** : le paiement Wave/Orange Money n'est pour l'instant qu'enregistré (lien marchand) — l'intégration API réelle (webhook de confirmation automatique) sera ajoutée une fois que tu me donnes les détails techniques de tes comptes marchands (documentation API Wave CI / Orange Money CI).
