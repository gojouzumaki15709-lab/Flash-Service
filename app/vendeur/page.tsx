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
  payment_method: { type: string; label: string } | null;
  items: PendingOrderItem[];
};

type DebtEntry = { id: string; amount: number; created_at: string };
type DebtClient = { id: string; name: string; phone: string };

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

  const [debtPhone, setDebtPhone] = useState("");
  const [debtClient, setDebtClient] = useState<DebtClient | null>(null);
  const [debtList, setDebtList] = useState<DebtEntry[]>([]);
  const [selectedDebtIds, setSelectedDebtIds] = useState<Record<string, boolean>>({});
  const [debtCash, setDebtCash] = useState("");
  const [debtMessage, setDebtMessage] = useState("");

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

  async function searchDebtClient() {
    setDebtMessage("");
    setDebtClient(null);
    setDebtList([]);
    setSelectedDebtIds({});
    setDebtCash("");
    if (!debtPhone.trim()) return;

    const res = await fetch(`/api/vendor/debts?phone=${encodeURIComponent(debtPhone.trim())}`);
    const data = await res.json();
    if (!res.ok) {
      setDebtMessage(data.error || "Erreur.");
      return;
    }
    setDebtClient(data.client);
    setDebtList(data.debts || []);
    if (!data.debts?.length) setDebtMessage("Ce client n'a aucune dette en cours.");
  }

  const selectedDebtTotal = debtList
    .filter((d) => selectedDebtIds[d.id])
    .reduce((sum, d) => sum + Number(d.amount), 0);

  async function confirmDebtRepayment() {
    setDebtMessage("");
    const debtIds = Object.keys(selectedDebtIds).filter((id) => selectedDebtIds[id]);
    if (!debtClient || !debtIds.length) {
      setDebtMessage("Sélectionne au moins une dette.");
      return;
    }
    const res = await fetch("/api/vendor/debts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: debtClient.id,
        debtIds,
        cashAmountReceived: debtCash !== "" ? Number(debtCash) : selectedDebtTotal,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setDebtMessage(data.error || "Erreur.");
      return;
    }
    setDebtMessage("Remboursement enregistré !");
    searchDebtClient();
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
          <strong>Statut de la boutique</strong>{" "}
          <span className={`badge ${isOpen ? "badge-success" : "badge-neutral"}`} style={{ marginLeft: 6 }}>
            {isOpen ? "Ouvert" : "Fermé"}
          </span>
          <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>Les clients ne voient ton stock que si tu es ouvert.</div>
        </div>
        <button className={isOpen ? "btn btn-primary" : "btn btn-accent"} onClick={toggleOpen}>
          {isOpen ? "Fermer" : "Ouvrir"}
        </button>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>
        Commandes en attente de confirmation
        {!!pendingOrders.length && (
          <span className="badge badge-warning" style={{ marginLeft: 8 }}>
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
            <div style={{ marginBottom: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: order.payment_method?.type === "wave" ? "#e6f0ff" : "#fff3e0",
                  color: order.payment_method?.type === "wave" ? "#1d4ed8" : "#b7791f",
                }}
              >
                {order.payment_method?.label || "Liquide"}
                {order.payment_method?.type === "wave" && " — vérifie ta réception Wave avant de confirmer"}
              </span>
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
                <label style={{ fontSize: 12, opacity: 0.7, marginRight: 4 }}>
                  {order.payment_method?.type === "wave" ? "Somme reçue sur Wave :" : "Somme reçue :"}
                </label>
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

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Remboursement de dette</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            type="tel"
            placeholder="Téléphone du client"
            value={debtPhone}
            onChange={(e) => setDebtPhone(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={searchDebtClient}>
            Rechercher
          </button>
        </div>

        {debtClient && (
          <>
            <p style={{ fontWeight: 700, marginBottom: 8 }}>{debtClient.name} — {debtClient.phone}</p>
            {debtList.map((d) => (
              <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 6 }}>
                <input
                  type="checkbox"
                  checked={!!selectedDebtIds[d.id]}
                  onChange={(e) => setSelectedDebtIds((s) => ({ ...s, [d.id]: e.target.checked }))}
                />
                <span>{d.amount} FCFA — {new Date(d.created_at).toLocaleDateString("fr-FR")}</span>
              </label>
            ))}
            {!!debtList.length && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0" }}>
                  <span style={{ fontSize: 13, opacity: 0.7 }}>Total sélectionné : {selectedDebtTotal} FCFA</span>
                  <div>
                    <label style={{ fontSize: 12, opacity: 0.7, marginRight: 4 }}>Somme reçue :</label>
                    <input
                      type="number"
                      min={0}
                      placeholder={String(selectedDebtTotal)}
                      value={debtCash}
                      onChange={(e) => setDebtCash(e.target.value)}
                      style={{ width: 90, textAlign: "center" }}
                    />
                  </div>
                </div>
                <button className="btn btn-primary" style={{ width: "100%" }} onClick={confirmDebtRepayment}>
                  Confirmer le remboursement
                </button>
              </>
            )}
          </>
        )}

        {debtMessage && (
          <p style={{ color: debtMessage.includes("enregistré") ? "var(--teal)" : "#c0392b", fontWeight: 600, marginTop: 8, fontSize: 13 }}>
            {debtMessage}
          </p>
        )}
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
