# Livraison : Flash-points, crédit, Flash day, hiérarchie admin, bouton info

Ce zip contient uniquement les fichiers **nouveaux ou modifiés** par rapport à
ton projet `sucrerie-app` (les autres fichiers de ton app n'ont pas bougé).
Copie-les par-dessus ton projet en respectant les chemins.

## 1. Étape obligatoire : la migration SQL

Exécute `supabase/migration_v12_flash_points.sql` dans Supabase (SQL Editor)
**après** toutes tes migrations existantes. Elle est idempotente (rejouable
sans erreur) et fait tout en une transaction :

- Colonnes Flash-points sur `clients` (`flash_unlocked`, `flash_points`, `flash_points_peak`).
- Table `flash_point_events` (historique, sert au calcul du top 3 mensuel).
- Fonction `award_flash_points_for_confirmed_order()` : implémente la règle
  "3 jours consécutifs avec ≥1 commande => débloqué à vie, puis +1 point par
  commande confirmée ensuite" — invisible tant que non débloqué.
- Redéfinit `confirm_vendor_order_atomic()` pour appeler cette fonction.
- Table `flash_credits` + fonctions `request_flash_credit_atomic()` et
  `confirm_flash_credit_cash_repayment_atomic()` : achat à crédit (10 points
  par prêt, débloqué à 100 points, réutilisable tant que le solde ne
  descend pas sous 20, plafonds de dette cumulée 1000/1500/2000 selon le
  solde de points au moment de la demande).
- Table `flash_days` (2 produits à -50 %, tous les 14 jours).
- `admins.is_chief` (hiérarchie admin).

## 2. Top 3 mensuel (récompenses "Flash bonus")

Pas d'automatisation de l'envoi des lots (ça reste une action humaine de
l'admin), mais la requête pour obtenir le classement du mois est prête à
brancher dans une route admin :

```sql
select client_id, sum(points) as points_du_mois
from flash_point_events
where points > 0
  and created_at >= date_trunc('month', now())
group by client_id
order by points_du_mois desc
limit 3;
```

Si tu veux, je peux te faire la route `/api/admin/flash-leaderboard` derrière
ça — dis-le-moi.

## 3. Backend : entièrement fonctionnel

Tous les endpoints ci-dessous sont prêts à l'emploi :

- `GET /api/client/flash` — statut Flash-points du client (reste invisible
  tant que non débloqué : renvoie juste `{ unlocked: false }`).
- `GET/POST /api/client/credit` — historique + demande d'achat à crédit.
- `POST /api/client/credit/repay` — rembourser (`mode: "cash"` ou `"wave"`).
- `GET/PATCH /api/vendor/credit-repayments` — n'importe quel vendeur voit et
  confirme les remboursements en liquide.
- `GET/POST /api/admin/flash-day` — planifier le Flash day (POST réservé au
  chef ; si tu ne donnes pas de date, le serveur en tire une au hasard dans
  les 14 prochains jours).
- `GET /api/admin/flash-day/notification` — à appeler quand le chef ouvre son
  panneau : renvoie le Flash day de demain s'il n'a pas encore été signalé.
- `GET /api/admin/admins` (chef uniquement désormais) et `DELETE
  /api/admin/admins?id=...` (chef uniquement, ne peut pas se supprimer
  lui-même).
- `node scripts/create-chief-admin.mjs <nom> <mot_de_passe>` — crée le tout
  premier admin en chef (refuse si un chef existe déjà).
- Webhook Wave étendu pour confirmer aussi les remboursements de crédit payés
  en direct sur le site (préfixe `credit:` sur la référence).
- Bug corrigé au passage : `app/api/admin/orders/route.ts` sélectionnait une
  colonne `is_debt` qui n'existe plus sur `orders` depuis le retrait de
  l'ancien système de dette — ça aurait fait planter la route.

## 4. Frontend : ce qui est fait vs. ce qui reste

**Fait** : le petit bouton "?" d'aide (`app/components/InfoButton.tsx`) est
câblé dans les trois espaces (client, vendeur, admin) — clic → modale avec le
strict minimum pour ne pas se perdre.

**Reste à faire côté écran** (le backend est prêt, il ne manque que
l'affichage) :
- Client : afficher le solde de Flash-points et le bouton "payer à crédit"
  quand `unlocked && creditAvailable` (voir `GET /api/client/flash`), et un
  onglet listant `GET /api/client/credit` pour rembourser.
- Vendeur : un onglet listant `GET /api/vendor/credit-repayments` avec un
  bouton "confirmer" (`PATCH`).
- Admin (chef) : un petit formulaire "Flash day" (2 produits + date
  optionnelle) posté sur `/api/admin/flash-day`, et l'appel à
  `/api/admin/flash-day/notification` au chargement du panneau.

Je n'ai pas touché à `app/client/page.tsx`, `app/vendeur/page.tsx` et
`app/admin/page.tsx` au-delà du bouton info (ce sont déjà des fichiers de
600+ lignes chacun) : dis-moi si tu veux que j'ajoute directement ces
écrans, je peux le faire dans un prochain message pour rester lisible.

## Note sur l'état de ton projet

En explorant le code, j'ai remarqué que `app/client/page.tsx` référence
encore l'ancien système de dette (`is_debt`, `/api/client/debts`), alors que
`supabase/migration_remove_debt_system.sql` l'a supprimé de la base et que
`app/api/orders/route.ts` utilise déjà la nouvelle signature sans dette. Ton
projet semble être entre deux états. Le nouveau système de crédit
(`flash_credits`) que j'ai ajouté est une table à part, donc ça ne
provoquera pas de conflit — mais tu voudras sans doute nettoyer les restants
de l'ancien système de dette dans l'UI à un moment donné.
