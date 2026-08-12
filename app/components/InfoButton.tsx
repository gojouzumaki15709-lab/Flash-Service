"use client";

import { useState } from "react";

// Bouton d'aide discret (icône "?") destiné aux nouveaux utilisateurs perdus
// sur le site : ouvre une petite modale qui explique le strict minimum pour
// s'en sortir, sans les noyer sous les détails. `role` adapte le texte
// affiché (client, vendeur, ou admin).
export default function InfoButton({ role }: { role: "client" | "vendeur" | "admin" }) {
  const [open, setOpen] = useState(false);

  const content: Record<typeof role, { title: string; items: string[] }> = {
    client: {
      title: "Comment ça marche ?",
      items: [
        "Choisis un vendeur ouvert (pastille verte), ajoute des produits à ton panier, puis commande.",
        "Indique ta chambre au format bâtiment-chambre (ex: 12-67 ou B-67) : c'est là que le vendeur t'apportera ta commande.",
        "Paie en liquide à la livraison ou directement par Wave.",
        "Onglet \"Historique\" : retrouve toutes tes commandes passées.",
        "Reste actif 3 jours de suite (au moins une commande par jour) : tu débloques les Flash-points, un système de fidélité qui peut ensuite te donner accès à l'achat à crédit.",
      ],
    },
    vendeur: {
      title: "Comment ça marche ?",
      items: [
        "Ouvre ta boutique (bouton en haut) pour recevoir des commandes.",
        "Gère ton stock produit par produit depuis l'onglet dédié.",
        "Les commandes en attente apparaissent en temps réel : confirme-les une fois le client livré et payé.",
        "Un client peut te rembourser une dette (achat à crédit) en liquide : confirme la réception dans l'onglet des remboursements.",
      ],
    },
    admin: {
      title: "Comment ça marche ?",
      items: [
        "Gère les bâtiments, vendeurs, produits et moyens de paiement depuis les onglets du panneau.",
        "Les commandes en attente et confirmées sont visibles pour vérification.",
        "Seul l'admin en chef voit la liste complète des autres admins et peut planifier le Flash day.",
      ],
    },
  };

  const { title, items } = content[role];

  return (
    <>
      <button
        type="button"
        aria-label="Aide"
        onClick={() => setOpen(true)}
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "1px solid var(--teal)",
          background: "#fff",
          color: "var(--teal)",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
          lineHeight: 1,
        }}
      >
        ?
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ maxWidth: 420, width: "100%" }}
          >
            <h2 style={{ marginTop: 0, fontSize: 18 }}>{title}</h2>
            <ul style={{ paddingLeft: 18, margin: "12px 0", lineHeight: 1.5 }}>
              {items.map((it, i) => (
                <li key={i} style={{ marginBottom: 8 }}>
                  {it}
                </li>
              ))}
            </ul>
            <button className="btn" style={{ width: "100%" }} onClick={() => setOpen(false)}>
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
}
