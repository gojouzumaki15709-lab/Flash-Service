"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type StockItem = {
  id: string;
  quantity: number;
  product: { id: string; name: string; price: number; low_stock_threshold: number };
};
type Product = { id: string; name: string; price: number };

type PendingOrderItem = {
  id: string;
  quantity: number;
  unit_price: number;
  product: { id: string; name: string };
};
type PendingOrder = {
  id: string;
  total: number;
  created_at: string;
  client: { name: string; phone: string };
  items: PendingOrderItem[];
};

export default function VendorPage() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [addProductId, setAddProductId] = useState("");
  const [addQty, setAddQty] = useState(0);

  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [editQty, setEditQty] = useState<Record<string, Record<string, number>>>({}); // orderId -> itemId -> qty
  const [editCash, setEditCash] = useState<Record<string, string>>({}); // orderId -> montant saisi
  const [confirmMessage, setConfirmMessage] = useState<Record<string, string>>({});

  async function loadStock() {
    const res = await fetch("/api/vendor/stock");
    const data = await res.json();
    setStock(data.stock || []);
  }

  async function loadPendingOrders() {
    const res = await fetch("/api/vendor/orders");
    const data = await res.json();
    const orders: PendingOrder[] = data.orders || [];
    setPendingOrders(orders);
    setEditQty((prev) => {
      const next = { ...prev };
      for (const o of orders) {
        if (!next[o.id]) {
          next[o.id] = {};
          for (const it of o.items) next[o.id][it.id] = it.quantity;
        }
      }
      return next;
    });
    setEditCash((prev) => {
      const next = { ...prev };
      for (const o of orders) {
        if (next[o.id] === undefined) next[o.id] = String(o.total);
      }
      return next;
    });
  }

  useEffect(() => {
    loadStock();
    loadPendingOrders();
    fetch("/api/admin/products").then((r) => r.json()).then((d) => setAllProducts(d.products || []));
  }, []);

  function orderComputedTotal(order: PendingOrder) {
    return order.items.reduce((sum, it) => sum + (editQty[order.id]?.[it.id] ?? it.quantity) * it.unit_price, 0);
  }

  async function confirmOrder(order: PendingOrder) {
    setConfirmMessage((m) => ({ ...m, [order.id]: "" }));
    const items = order.items.map((it) => ({ orderItemId: it.id, quantity: editQty[order.id]?.[it.id] ?? it.quantity }));
    const cashAmountReceived = editCash[order.id] !== "" ? Number(editCash[order.id]) : orderComputedTotal(order);

    const res = await fetch("/api/vendor/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id, action: "confirm", cashAmountReceived, items }),
    });
    const data = await res.json();
    if (!res.ok) {
      setConfirmMessage((m) => ({ ...m, [order.id]: data.error || "Erreur." }));
      return;
    }
    loadPendingOrders();
    loadStock();
  }

  async function rejectOrder(order: PendingOrder) {
    if (!confirm("Annuler cette commande et remettre le stock disponible ?")) return;
    const res = await fetch("/api/vendor/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id, action: "reject" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setConfirmMessage((m) => ({ ...m, [order.id]: data.error || "Erreur." }));
      return;
    }
    loadPendingOrders();
    loadStock();
  }

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

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>
        Commandes en attente (paiement liquide)
        {!!pendingOrders.length && (
          <span
            style={{
              marginLeft: 8,
              fontSize: 12,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#fbe6c8",
              color: "#a15c0a",
            }}
          >
            {pendingOrders.length}
          </span>
        )}
      </h2>
      <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
        {pendingOrders.map((order) => (
          <div key={order.id} className="card" style={{ borderColor: "#e59a3d" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <strong>{order.client?.name}</strong>
              <span style={{ fontSize: 13, opacity: 0.7 }}>{order.client?.phone}</span>
            </div>

            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              {order.items.map((it) => (
                <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14 }}>
                    {it.product.name} <span style={{ opacity: 0.6 }}>({it.unit_price} FCFA/u — commandé : {it.quantity})</span>
                  </span>
                  <div>
                    <label style={{ fontSize: 12, opacity: 0.7, marginRight: 4 }}>Pris :</label>
                    <input
                      type="number"
                      min={0}
                      max={it.quantity}
                      value={editQty[order.id]?.[it.id] ?? it.quantity}
                      onChange={(e) =>
                        setEditQty((prev) => ({
                          ...prev,
                          [order.id]: { ...prev[order.id], [it.id]: Math.max(0, Math.min(it.quantity, Number(e.target.value))) },
                        }))
                      }
                      style={{ width: 60, textAlign: "center" }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, opacity: 0.7 }}>Total attendu : {orderComputedTotal(order)} FCFA</span>
              <div>
                <label style={{ fontSize: 12, opacity: 0.7, marginRight: 4 }}>Somme reçue :</label>
                <input
                  type="number"
                  min={0}
                  value={editCash[order.id] ?? ""}
                  onChange={(e) => setEditCash((prev) => ({ ...prev, [order.id]: e.target.value }))}
                  style={{ width: 90, textAlign: "center" }}
                />
              </div>
            </div>

            {confirmMessage[order.id] && (
              <p style={{ color: "#c0392b", fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{confirmMessage[order.id]}</p>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => confirmOrder(order)}>
                Confirmer la vente
              </button>
              <button
                className="btn"
                style={{ background: "#f1ede2", boxShadow: "none" }}
                onClick={() => rejectOrder(order)}
              >
                Annuler
              </button>
            </div>
          </div>
        ))}
        {!pendingOrders.length && <p style={{ opacity: 0.6, fontSize: 14 }}>Aucune commande en attente.</p>}
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
