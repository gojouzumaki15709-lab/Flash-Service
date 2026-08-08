"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type StockItem = {
  id: string;
  quantity: number;
  product: { id: string; name: string; price: number; low_stock_threshold: number };
};
type Product = { id: string; name: string; price: number };

export default function VendorPage() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [addProductId, setAddProductId] = useState("");
  const [addQty, setAddQty] = useState(0);

  async function loadStock() {
    const res = await fetch("/api/vendor/stock");
    const data = await res.json();
    setStock(data.stock || []);
  }

  useEffect(() => {
    loadStock();
    fetch("/api/admin/products").then((r) => r.json()).then((d) => setAllProducts(d.products || []));
  }, []);

  async function toggleOpen() {
    const next = !isOpen;
    setIsOpen(next);
    await fetch("/api/vendor/toggle-open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isOpen: next }),
    });
  }

  async function updateQuantity(productId: string, quantity: number) {
    await fetch("/api/vendor/stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, quantity }),
    });
    loadStock();
  }

  async function addProduct() {
    if (!addProductId) return;
    await updateQuantity(addProductId, addQty);
    setAddProductId("");
    setAddQty(0);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  const stockedIds = new Set(stock.map((s) => s.product.id));
  const availableToAdd = allProducts.filter((p) => !stockedIds.has(p.id));

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 className="display" style={{ fontSize: 24, color: "var(--teal)" }}>Espace vendeur</h1>
        <button className="btn" style={{ background: "#f1ede2", boxShadow: "none", fontSize: 13 }} onClick={logout}>
          Déconnexion
        </button>
      </div>

      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <strong>Statut de la boutique</strong>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Les clients ne voient ton stock que si tu es ouvert.</div>
        </div>
        <button className={isOpen ? "btn btn-primary" : "btn btn-accent"} onClick={toggleOpen}>
          {isOpen ? "Ouvert — fermer" : "Fermé — ouvrir"}
        </button>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Mon stock</h2>
      <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
        {stock.map((s) => {
          const low = s.quantity <= s.product.low_stock_threshold;
          return (
            <div key={s.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderColor: low ? "#e59a3d" : undefined }}>
              <div>
                <strong>{s.product.name}</strong>
                <div style={{ fontSize: 13, opacity: 0.7 }}>{s.product.price} FCFA</div>
                {low && <div style={{ fontSize: 12, color: "#c0392b", fontWeight: 700, marginTop: 2 }}>⚠ Stock bas — pense à réapprovisionner</div>}
              </div>
              <input
                type="number"
                min={0}
                value={s.quantity}
                onChange={(e) => updateQuantity(s.product.id, Number(e.target.value))}
                style={{ width: 72, textAlign: "center" }}
              />
            </div>
          );
        })}
        {!stock.length && <p style={{ opacity: 0.6 }}>Aucun produit dans ton stock pour l'instant.</p>}
      </div>

      {!!availableToAdd.length && (
        <div className="card">
          <p style={{ fontWeight: 700, marginBottom: 10 }}>Ajouter un produit du catalogue</p>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)}>
              <option value="">— Produit —</option>
              {availableToAdd.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input type="number" min={0} value={addQty} onChange={(e) => setAddQty(Number(e.target.value))} style={{ width: 80 }} />
            <button className="btn btn-primary" onClick={addProduct}>Ajouter</button>
          </div>
        </div>
      )}
    </main>
  );
}
