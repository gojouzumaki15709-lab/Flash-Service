# V4 → V5 — corrections appliquées

Ces changements corrigent les deux problèmes que le rapport V3/V4 disait
réglés mais qui ne l'étaient pas dans le ZIP réellement inspecté.

## 1. Suppression vendeur (🔴1, 🔴2, 🔴27)

- **`supabase/migration_vendor_is_active.sql`** (nouveau) : ajoute
  `vendors.is_active boolean not null default true`. À exécuter dans
  Supabase (SQL editor ou CLI) — idempotent, rejouable sans risque.
- **`app/api/admin/vendors/[id]/route.ts`** : `DELETE` ne fait plus de
  suppression physique (qui échouait silencieusement dès qu'un vendeur
  avait des commandes/remboursements en historique). Il met `is_active =
  false`. Ajout d'un `PATCH` pour réactiver.
- **`lib/auth.ts`** — `getSession()` : pour un rôle `vendor`, revérifie
  désormais `is_active` en base à chaque appel. Un vendeur désactivé perd
  l'accès immédiatement, plus besoin d'attendre l'expiration du cookie
  (30 jours).
- **`middleware.ts`** : même vérification, via un appel REST direct à
  Supabase (le middleware tourne en edge runtime, sans le SDK admin
  node). Un vendeur désactivé est redirigé et son cookie supprimé dès sa
  prochaine visite sur `/vendeur`.
- **`app/api/auth/login/route.ts`** : refuse la connexion d'un vendeur
  désactivé (même mot de passe correct), avec le même message générique
  que les autres échecs de login.
- **`app/api/admin/vendors/route.ts`** : le `GET` renvoie maintenant
  `is_active` pour que l'admin le voie.
- **`app/admin/page.tsx`** : badge "Désactivé", bouton "Réactiver", et le
  bouton "Supprimer" vérifie enfin `res.ok` et affiche l'erreur au lieu
  de recharger silencieusement une liste inchangée.

## 2. Produit archivé encore modifiable par le vendeur (🔴4, 🔴5, 🟠13)

- **`app/api/vendor/stock/route.ts`** (route authentifiée réellement
  utilisée par le vendeur, pas la route publique déjà corrigée en V4) :
  - `GET` filtre désormais `product.is_archived`.
  - `POST` vérifie que le produit n'est pas archivé avant toute écriture,
    et renvoie une erreur explicite sinon.
  - Toutes les erreurs DB (`update`/`insert`) sont désormais vérifiées et
    renvoyées au lieu d'être avalées derrière un `{ ok: true }`
    systématique.

## Ce qui reste à faire (non traité ici, hors périmètre demandé)

- `vendor_products (vendor_id, product_id, is_active)` pour des
  autorisations produit **par vendeur** (actuellement, `is_archived` est
  global — tous les vendeurs perdent/retrouvent l'accès en même temps).
- Rotation des anciennes clés Wave (déjà signalée en V3/V4).
- Migration hors Next.js 14.x (branche non supportée).
- Rate limiting sur `/api/auth/login`.
- `stock_movements` / `audit_log` pour la traçabilité.

## Déploiement

1. Exécuter `supabase/migration_vendor_is_active.sql` sur la base.
2. Vérifier que `migration_hardening_v3.sql` et `migration_hardening_v4.sql`
   ont bien été appliquées aussi (elles ne l'étaient pas forcément selon
   ta base actuelle).
3. Déployer le code.
4. Tester : désactiver un vendeur test, vérifier qu'il est immédiatement
   rejeté (page ET API), puis le réactiver.
