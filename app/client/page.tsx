"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Vendor = { id: string; name: string; is_open: boolean; building: { letter: string; number: number } };
type StockItem = { id: string; quantity: number; product: { id: string; name: string; image_url: string | null; price: number } };
type PaymentMethod = { id: string; type: string; label: string; is_active: boolean; icon_url: string | null };
type Debt = { id: string; amount: number; created_at: string; order: { vendor: { name: string } } | null };

type OrderHistoryItem = { quantity: number; quantity_taken: number | null; unit_price: number; product: { name: string } };
type OrderHistory = {
  id: string;
  total: number;
  status: string;
  is_debt: boolean;
  cash_amount_received: number | null;
  created_at: string;
  vendor: { name: string } | null;
  payment_method: { label: string; type: string } | null;
  items: OrderHistoryItem[];
};

const STATUS_LABELS: Record<string, { label: string; badgeClass: string }> = {
  confirmed: { label: "Confirmée", badgeClass: "badge-success" },
  pending: { label: "En attente", badgeClass: "badge-warning" },
  cancelled: { label: "Annulée", badgeClass: "badge-danger" },
};

export default function ClientPage() {
  const router = useRouter();
  const [view, setView] = useState<"vendors" | "history">("vendors");
  const [waveReturnMessage, setWaveReturnMessage] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [isDebt, setIsDebt] = useState(false);
  const [message, setMessage] = useState("");
  const [debtTotal, setDebtTotal] = useState(0);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [selectedDebtIds, setSelectedDebtIds] = useState<Set<string>>(new Set());
  const [pendingRepaymentDebtIds, setPendingRepaymentDebtIds] = useState<Set<string>>(new Set());
  const [repayMethodId, setRepayMethodId] = useState("");
  const [repayMessage, setRepayMessage] = useState("");
  const [orderHistory, setOrderHistory] = useState<OrderHistory[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  async function loadDebts() {
    const res = await fetch("/api/client/debts");
    const data = await res.json();
    setDebtTotal(data.total || 0);
    setDebts(data.debts || []);
    setPendingRepaymentDebtIds(new Set<string>(data.pendingDebtIds || []));
    setSelectedDebtIds((prev) => {
      const next = new Set(prev);
      for (const id of data.pendingDebtIds || []) next.delete(id);
      return next;
    });
  }

  function toggleDebtSelection(debtId: string) {
    setSelectedDebtIds((prev) => {
      const next = new Set(prev);
      if (next.has(debtId)) next.delete(debtId);
      else next.add(debtId);
      return next;
    });
  }

  const selectedDebtsTotal = debts
    .filter((d) => selectedDebtIds.has(d.id))
    .reduce((sum, d) => sum + Number(d.amount), 0);

  async function submitRepayment() {
    setRepayMessage("");
    const res = await fetch("/api/client/debts/repay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        debtIds: Array.from(selectedDebtIds),
        paymentMethodId: repayMethodId || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRepayMessage(data.error);
      return;
    }
    if (data.waveLaunchUrl) {
      window.open(data.waveLaunchUrl, "_blank");
      setRepayMessage(`Paie exactement ${selectedDebtsTotal} FCFA via Wave (nouvel onglet), un vendeur confirmera dès réception.`);
    } else {
      setRepayMessage("Enregistré : un vendeur confirmera dès réception du paiement en liquide.");
    }
    setSelectedDebtIds(new Set());
    setRepayMethodId("");
    loadDebts();
  }

  async function loadHistory() {
    const res = await fetch("/api/client/orders");
    const data = await res.json();
    setOrderHistory(data.orders || []);
    setTotalSpent(data.totalSpent || 0);
    setHistoryLoaded(true);
  }

  useEffect(() => {
    fetch("/api/vendors").then((r) => r.json()).then((d) => setVendors(d.vendors || []));
    fetch("/api/admin/payment-methods").then((r) => r.json()).then((d) => setPaymentMethods((d.paymentMethods || []).filter((p: PaymentMethod) => p.is_active)));
    loadDebts();

    // Retour depuis Wave après paiement (succès ou erreur). Le statut réel de
    // la commande est confirmé côté serveur par le webhook Wave, pas par ce
    // paramètre d'URL — ici on ne fait qu'informer visuellement le client.
    const params = new URLSearchParams(window.location.search);
    const waveStatus = params.get("wave");
    if (waveStatus === "success") {
      setWaveReturnMessage("Paiement Wave reçu ! La commande sera confirmée dans quelques instants.");
      setHistoryLoaded(false);
      setView("history");
    } else if (waveStatus === "error") {
      setWaveReturnMessage("Le paiement Wave n'a pas abouti. Tu peux réessayer depuis le vendeur.");
    }
    if (waveStatus) {
      window.history.replaceState({}, "", "/client");
    }
  }, []);

  useEffect(() => {
    if (view === "history" && !historyLoaded) loadHistory();
  }, [view, historyLoaded]);

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

    // Paiement Wave en mode API : redirection classique de navigateur vers
    // wave_launch_url (jamais en iframe/webview, sinon l'app Wave ne s'ouvre pas).
    if (data.waveLaunchUrl && data.waveMode === "api") {
      window.location.href = data.waveLaunchUrl;
      return;
    }

    // Paiement Wave en mode lien simple : pas de confirmation automatique.
    // On ouvre le lien marchand dans un nouvel onglet et on explique au client
    // qu'il doit payer EXACTEMENT le montant affiché, puis attendre que le
    // vendeur confirme la réception du paiement dans l'appli.
    if (data.waveLaunchUrl && data.waveMode === "link") {
      window.open(data.waveLaunchUrl, "_blank");
      setMessage(
        `Commande enregistrée. Paie exactement ${total} FCFA via Wave (lien ouvert dans un nouvel onglet), puis patiente : le vendeur confirmera ta commande dès réception du paiement.`
      );
      setCart({});
      openVendor(selectedVendor!);
      loadDebts();
      setHistoryLoaded(false);
      return;
    }

    setMessage("Commande passée avec succès !");
    setCart({});
    openVendor(selectedVendor!);
    loadDebts();
    setHistoryLoaded(false);
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

      {waveReturnMessage && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid var(--teal)" }}>
          {waveReturnMessage}
        </div>
      )}

      {!selectedVendor ? (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              className="btn"
              style={{
                flex: 1,
                background: view === "vendors" ? "var(--teal)" : "#f1ede2",
                color: view === "vendors" ? "#fff" : "inherit",
                boxShadow: "none",
              }}
              onClick={() => setView("vendors")}
            >
              Vendeurs
            </button>
            <button
              className="btn"
              style={{
                flex: 1,
                background: view === "history" ? "var(--teal)" : "#f1ede2",
                color: view === "history" ? "#fff" : "inherit",
                boxShadow: "none",
              }}
              onClick={() => setView("history")}
            >
              Mes achats
            </button>
          </div>

          {view === "history" ? (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <p style={{ fontWeight: 700 }}>Total dépensé : {totalSpent} FCFA</p>
                <p style={{ fontSize: 12, opacity: 0.6 }}>(commandes confirmées uniquement)</p>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {orderHistory.map((o) => {
                  const statusInfo = STATUS_LABELS[o.status] || { label: o.status, badgeClass: "badge-neutral" };
                  return (
                    <div key={o.id} className="card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <strong>{o.vendor?.name || "Vendeur"}</strong>
                        <span className={`badge ${statusInfo.badgeClass}`}>{statusInfo.label}</span>
                      </div>
                      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
                        {o.items.map((it, i) => (
                          <div key={i}>
                            {it.quantity} × {it.product.name} ({it.unit_price} FCFA/u)
                            {it.quantity_taken != null && it.quantity_taken !== it.quantity && (
                              <span style={{ color: "#a15c0a" }}> — {it.quantity_taken} remis(e)</span>
                            )}
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span style={{ opacity: 0.6 }}>
                          {new Date(o.created_at).toLocaleDateString("fr-FR")} —{" "}
                          {o.is_debt ? "Dette" : o.payment_method?.label || "—"}
                        </span>
                        <strong>{o.total} FCFA</strong>
                      </div>
                    </div>
                  );
                })}
                {!orderHistory.length && <p style={{ opacity: 0.6 }}>Aucun achat pour le moment.</p>}
              </div>
            </>
          ) : (
            <>
              {debtTotal > 0 && (
                <div className="card" style={{ marginBottom: 16, borderColor: "#e59a3d" }}>
                  <p style={{ fontWeight: 700, marginBottom: 6 }}>
                    Dette actuelle : {debtTotal} FCFA <span style={{ fontWeight: 400, opacity: 0.7 }}>(plafond 1000 FCFA)</span>
                  </p>
                  <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
                    {debts.map((d) => {
                      const pending = pendingRepaymentDebtIds.has(d.id);
                      return (
                        <label
                          key={d.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: 13,
                            opacity: pending ? 0.5 : 0.9,
                            gap: 8,
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input
                              type="checkbox"
                              disabled={pending}
                              checked={selectedDebtIds.has(d.id)}
                              onChange={() => toggleDebtSelection(d.id)}
                            />
                            {d.order?.vendor?.name || "Vendeur"} — {new Date(d.created_at).toLocaleDateString("fr-FR")}
                            {pending && <span style={{ fontSize: 11, opacity: 0.8 }}> (remboursement en attente)</span>}
                          </span>
                          <span>{d.amount} FCFA</span>
                        </label>
                      );
                    })}
                  </div>

                  {selectedDebtIds.size > 0 && (
                    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                        Rembourser {selectedDebtsTotal} FCFA sélectionné(s)
                      </p>
                      <select
                        value={repayMethodId}
                        onChange={(e) => setRepayMethodId(e.target.value)}
                        style={{ marginBottom: 8 }}
                      >
                        <option value="">Je paierai en liquide chez un vendeur</option>
                        {paymentMethods
                          .filter((p) => p.type === "wave")
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label} (paiement en ligne)
                            </option>
                          ))}
                      </select>
                      {repayMessage && (
                        <p style={{ color: repayMessage.includes("succès") || repayMessage.includes("enregistr") ? "var(--teal)" : "#c0392b", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                          {repayMessage}
                        </p>
                      )}
                      <button className="btn btn-primary" style={{ width: "100%" }} onClick={submitRepayment}>
                        {repayMethodId ? "Payer via Wave" : "Enregistrer (je paierai en liquide)"}
                      </button>
                    </div>
                  )}

                  <p style={{ fontSize: 12, opacity: 0.6, marginTop: 10 }}>
                    Choix "liquide" : un vendeur confirmera dès réception du paiement en personne. Choix Wave : paie le montant exact via le lien, un vendeur confirmera dès réception.
                  </p>
                </div>
              )}

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
          )}
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
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {s.product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.product.image_url}
                      alt={s.product.name}
                      style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 12, flexShrink: 0 }}
                      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                    />
                  ) : (
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 12,
                        background: "#f1ede2",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 22,
                        flexShrink: 0,
                      }}
                    >
                      🍬
                    </div>
                  )}
                  <div>
                    <strong>{s.product.name}</strong>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>
                      {s.product.price} FCFA — en stock : {s.quantity}
                    </div>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8, margin: "8px 0 14px" }}>
              {paymentMethods.map((p) => {
                const selected = !isDebt && paymentMethodId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setIsDebt(false);
                      setPaymentMethodId(p.id);
                    }}
                    className="card"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: "10px 6px",
                      cursor: "pointer",
                      border: selected ? "2px solid var(--teal)" : "1px solid var(--line)",
                      background: selected ? "#e5f5ef" : "#fff",
                    }}
                  >
                    {p.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.icon_url}
                        alt={p.label}
                        style={{ width: 32, height: 32, objectFit: "contain" }}
                        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                      />
                    ) : (
                      <span style={{ fontSize: 22 }}>💳</span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, textAlign: "center" }}>{p.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setIsDebt(true);
                  setPaymentMethodId("");
                }}
                className="card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 6px",
                  cursor: "pointer",
                  border: isDebt ? "2px solid var(--mango-dark)" : "1px solid var(--line)",
                  background: isDebt ? "#fff1e6" : "#fff",
                }}
              >
                <span style={{ fontSize: 22 }}>🕒</span>
                <span style={{ fontSize: 11, fontWeight: 700, textAlign: "center" }}>Dette</span>
              </button>
            </div>

            {isDebt && (
              <p style={{ fontSize: 12, opacity: 0.7, marginTop: -8, marginBottom: 12 }}>
                Plafond 1000 FCFA — reste {Math.max(0, 1000 - debtTotal)} FCFA disponible.
              </p>
            )}

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
