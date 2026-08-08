"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Vendor = { id: string; name: string; is_open: boolean; building: { letter: string; number: number } };
type StockItem = { id: string; quantity: number; product: { id: string; name: string; image_url: string | null; price: number } };
type PaymentMethod = { id: string; type: string; label: string; is_active: boolean };

export default function ClientPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [isDebt, setIsDebt] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/vendors").then((r) => r.json()).then((d) => setVendors(d.vendors || []));
    fetch("/api/admin/payment-methods").then((r) => r.json()).then((d) => setPaymentMethods((d.paymentMethods || []).filter((p: PaymentMethod) => p.is_active)));
  }, []);

  async function openVendor(v: Vendor) {
    setSelectedVendor(v);
    setCart({});
    setMessage("");
    const res = await fetch(`/api/vendors/${v.id}/stock`);
    const data = await res.json();
    setStock(data.stock || []);
  }

  function updateCart(productId: string, qty: number) {
    setCart((c) => ({ ...c, [productId]: Math.max(0, qty) }));
  }

  const total = stock.reduce((sum, s) => sum + (cart[s.product.id] || 0) * s.product.price, 0);

  async function placeOrder() {
    setMessage("");
    const items = Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));
    if (!items.length) {
      setMessage("Ton panier est vide.");
      return;
    }
    if (!isDebt && !paymentMethodId) {
      setMessage("Choisis un mode de paiement.");
      return;
    }
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId: selectedVendor!.id,
        items,
        paymentMethodId: isDebt ? null : paymentMethodId,
        isDebt,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error);
      return;
    }
    setMessage("Commande passée avec succès !");
    setCart({});
    openVendor(selectedVendor!);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 className="display" style={{ fontSize: 24, color: "var(--teal)" }}>🍬 Sucrerie</h1>
        <button className="btn" style={{ background: "#f1ede2", boxShadow: "none", fontSize: 13 }} onClick={logout}>
          Déconnexion
        </button>
      </div>

      {!selectedVendor ? (
        <>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Vendeurs</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {vendors.map((v) => (
              <button
                key={v.id}
                onClick={() => v.is_open && openVendor(v)}
                className="card"
                style={{
                  textAlign: "left",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  opacity: v.is_open ? 1 : 0.5,
                  cursor: v.is_open ? "pointer" : "not-allowed",
                }}
              >
                <div>
                  <strong>{v.name}</strong>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>
                    Bâtiment {v.building.letter}{v.building.number}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: v.is_open ? "#e5f5ef" : "#f1ede2",
                    color: v.is_open ? "var(--teal)" : "#888",
                  }}
                >
                  {v.is_open ? "Ouvert" : "Fermé"}
                </span>
              </button>
            ))}
            {!vendors.length && <p style={{ opacity: 0.6 }}>Aucun vendeur pour le moment.</p>}
          </div>
        </>
      ) : (
        <>
          <button className="btn" style={{ background: "none", boxShadow: "none", padding: 0, marginBottom: 14, fontWeight: 700 }} onClick={() => setSelectedVendor(null)}>
            ← Retour aux vendeurs
          </button>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>{selectedVendor.name}</h2>

          <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
            {stock.map((s) => (
              <div key={s.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{s.product.name}</strong>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>
                    {s.product.price} FCFA — en stock : {s.quantity}
                  </div>
                </div>
                <input
                  type="number"
                  min={0}
                  max={s.quantity}
                  value={cart[s.product.id] || 0}
                  onChange={(e) => updateCart(s.product.id, Math.min(s.quantity, Number(e.target.value)))}
                  style={{ width: 64, textAlign: "center" }}
                  disabled={s.quantity === 0}
                />
              </div>
            ))}
          </div>

          <div className="card">
            <p style={{ fontWeight: 700, marginBottom: 10 }}>Total : {total} FCFA</p>

            <label className="label">Mode de paiement</label>
            <select
              value={isDebt ? "debt" : paymentMethodId}
              onChange={(e) => {
                if (e.target.value === "debt") {
                  setIsDebt(true);
                  setPaymentMethodId("");
                } else {
                  setIsDebt(false);
                  setPaymentMethodId(e.target.value);
                }
              }}
              style={{ marginBottom: 12 }}
            >
              <option value="">— Choisir —</option>
              {paymentMethods.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
              <option value="debt">Dette (à rembourser, max 1000 FCFA)</option>
            </select>

            {message && <p style={{ color: message.includes("succès") ? "var(--teal)" : "#c0392b", fontWeight: 600, marginBottom: 10 }}>{message}</p>}

            <button className="btn btn-accent" style={{ width: "100%" }} onClick={placeOrder}>
              Commander
            </button>
          </div>
        </>
      )}
    </main>
  );
}
