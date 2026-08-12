"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "../components/PasswordInput";

type Tab = "orders" | "vendors" | "products" | "payments" | "alerts" | "clients";

const TAB_DEFS: [Tab, string][] = [
  ["orders", "Commandes"],
  ["vendors", "Vendeurs"],
  ["products", "Produits"],
  ["payments", "Paiements"],
  ["alerts", "Alertes stock"],
  ["clients", "Clients fréquents"],
];

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("vendors");
  const [counts, setCounts] = useState<Partial<Record<Tab, number>>>({});

  function reportCount(id: Tab, count: number) {
    setCounts((c) => (c[id] === count ? c : { ...c, [id]: count }));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Flash Service" style={{ width: 40, height: 40, borderRadius: 10 }} />
          <h1 className="display" style={{ fontSize: 20, color: "var(--teal)" }}>Administration</h1>
        </div>
        <button className="btn" style={{ background: "#f1ede2", boxShadow: "none", fontSize: 13 }} onClick={logout}>
          Déconnexion
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {TAB_DEFS.map(([id, label]) => {
          const count = counts[id];
          const isAlerts = id === "alerts" && !!count;
          const isOrders = id === "orders" && !!count;
          return (
            <button
              key={id}
              className="btn"
              style={{
                fontSize: 12,
                padding: "8px 14px",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: tab === id ? "var(--teal)" : "#f1ede2",
                color: tab === id ? "#fff" : "var(--ink)",
                boxShadow: "none",
              }}
              onClick={() => setTab(id)}
            >
              {label}
              {!!count && (
                <span
                  className={`badge ${isAlerts ? "badge-danger" : isOrders ? "badge-warning" : "badge-neutral"}`}
                  style={{
                    padding: "1px 8px",
                    fontSize: 11,
                    background: tab === id ? "rgba(255,255,255,0.25)" : undefined,
                    color: tab === id ? "#fff" : undefined,
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "orders" && <OrdersTab onCount={(n) => reportCount("orders", n)} />}
      {tab === "vendors" && <VendorsTab onCount={(n) => reportCount("vendors", n)} />}
      {tab === "products" && <ProductsTab onCount={(n) => reportCount("products", n)} />}
      {tab === "payments" && <PaymentsTab onCount={(n) => reportCount("payments", n)} />}
      {tab === "alerts" && <AlertsTab onCount={(n) => reportCount("alerts", n)} />}
      {tab === "clients" && <ClientsTab onCount={(n) => reportCount("clients", n)} />}
    </main>
  );
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${date} à ${time}`;
}

function OrdersTab({ onCount }: { onCount: (n: number) => void }) {
  const [pending, setPending] = useState<any[]>([]);
  const [confirmed, setConfirmed] = useState<any[]>([]);
  const [subTab, setSubTab] = useState<"pending" | "confirmed">("pending");
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch("/api/admin/orders")
      .then((r) => r.json())
      .then((d) => {
        const p = d.pending || [];
        setPending(p);
        setConfirmed(d.confirmed || []);
        onCount(p.length);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function itemsSummary(o: any) {
    return (o.items || [])
      .map((it: any) => `${it.quantity_taken != null ? it.quantity_taken : it.quantity} × ${it.product?.name}`)
      .join(", ");
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          className="btn"
          style={{
            fontSize: 12,
            padding: "8px 14px",
            background: subTab === "pending" ? "var(--mango)" : "#f1ede2",
            color: subTab === "pending" ? "var(--ink)" : "var(--ink)",
            boxShadow: "none",
          }}
          onClick={() => setSubTab("pending")}
        >
          En attente {pending.length ? `(${pending.length})` : ""}
        </button>
        <button
          className="btn"
          style={{
            fontSize: 12,
            padding: "8px 14px",
            background: subTab === "confirmed" ? "var(--teal)" : "#f1ede2",
            color: subTab === "confirmed" ? "#fff" : "var(--ink)",
            boxShadow: "none",
          }}
          onClick={() => setSubTab("confirmed")}
        >
          Confirmées
        </button>
      </div>

      {loading && <p style={{ opacity: 0.6 }}>Chargement…</p>}

      {!loading && subTab === "pending" && (
        <div style={{ display: "grid", gap: 10 }}>
          {pending.map((o) => (
            <div key={o.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <strong>{o.client?.name || "Client"}</strong> ({o.client?.phone || "—"})
                  <div style={{ fontSize: 13, opacity: 0.7 }}>chez {o.vendor?.name || "Vendeur"}</div>
                </div>
                <span className="badge badge-warning">En attente</span>
              </div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>{itemsSummary(o)}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, opacity: 0.75 }}>
                <span>Passée le {formatDateTime(o.created_at)}</span>
                <strong>{o.total} FCFA</strong>
              </div>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
                {o.is_debt ? "Dette" : o.payment_method?.label || "—"}
              </div>
            </div>
          ))}
          {!pending.length && <p style={{ opacity: 0.6 }}>Aucune commande en attente.</p>}
        </div>
      )}

      {!loading && subTab === "confirmed" && (
        <div style={{ display: "grid", gap: 10 }}>
          {confirmed.map((o) => (
            <div key={o.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <strong>{o.client?.name || "Client"}</strong> ({o.client?.phone || "—"})
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Vendeur : {o.vendor?.name || "—"}</div>
                </div>
                <span className="badge badge-success">Confirmée</span>
              </div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>{itemsSummary(o)}</div>
              <div style={{ fontSize: 12, opacity: 0.7, display: "grid", gap: 2 }}>
                <span>Créée le {formatDateTime(o.created_at)}</span>
                <span>Validée le {formatDateTime(o.confirmed_at)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 6 }}>
                <span style={{ opacity: 0.6 }}>{o.is_debt ? "Dette" : o.payment_method?.label || "—"}</span>
                <strong>{o.total} FCFA</strong>
              </div>
            </div>
          ))}
          {!confirmed.length && <p style={{ opacity: 0.6 }}>Aucune commande confirmée pour le moment.</p>}
        </div>
      )}
    </div>
  );
}

function VendorsTab({ onCount }: { onCount: (n: number) => void }) {
  const [vendors, setVendors] = useState<any[]>([]);
  const [buildings, setBuildings] = useState<any[]>([]);
  const [form, setForm] = useState({ code: "", name: "", password: "", buildingId: "" });
  const [error, setError] = useState("");
  const [expandedVendorId, setExpandedVendorId] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/vendors").then((r) => r.json()).then((d) => {
      const list = d.vendors || [];
      setVendors(list);
      onCount(list.length);
    });
    fetch("/api/admin/buildings").then((r) => r.json()).then((d) => setBuildings(d.buildings || []));
  }
  useEffect(load, []);

  async function createVendor(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setForm({ code: "", name: "", password: "", buildingId: "" });
    load();
  }

  async function removeVendor(id: string) {
    await fetch(`/api/admin/vendors/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <form onSubmit={createVendor} className="card" style={{ display: "grid", gap: 10 }}>
        <p style={{ fontWeight: 700 }}>Créer un compte vendeur</p>
        <input placeholder="Code de connexion" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        <input placeholder="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <PasswordInput
          value={form.password}
          onChange={(v) => setForm({ ...form, password: v })}
          placeholder="Mot de passe"
          autoComplete="new-password"
          required
        />
        <select value={form.buildingId} onChange={(e) => setForm({ ...form, buildingId: e.target.value })} required>
          <option value="">— Bâtiment —</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>{b.letter}{b.number}</option>
          ))}
        </select>
        {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}
        <button className="btn btn-primary" type="submit">Créer</button>
      </form>

      <div style={{ display: "grid", gap: 10 }}>
        {vendors.map((v) => (
          <div key={v.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>{v.name}</strong> ({v.code})
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  Bâtiment {v.building?.letter}{v.building?.number} — {v.is_open ? "Ouvert" : "Fermé"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn"
                  style={{ background: "#f1ede2", boxShadow: "none", fontSize: 12 }}
                  onClick={() => setExpandedVendorId(expandedVendorId === v.id ? null : v.id)}
                >
                  {expandedVendorId === v.id ? "Fermer" : "Gérer le stock"}
                </button>
                <button className="btn" style={{ background: "#fbe4e0", color: "#c0392b", boxShadow: "none", fontSize: 12 }} onClick={() => removeVendor(v.id)}>
                  Supprimer
                </button>
              </div>
            </div>
            {expandedVendorId === v.id && <VendorStockManager vendorId={v.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function VendorStockManager({ vendorId }: { vendorId: string }) {
  const [stock, setStock] = useState<any[]>([]);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [addProductId, setAddProductId] = useState("");
  const [addQty, setAddQty] = useState(0);

  function load() {
    fetch(`/api/admin/vendor-stock?vendorId=${vendorId}`).then((r) => r.json()).then((d) => setStock(d.stock || []));
    fetch("/api/admin/products").then((r) => r.json()).then((d) => setAllProducts(d.products || []));
  }
  useEffect(load, [vendorId]);

  async function updateQuantity(productId: string, quantity: number) {
    await fetch("/api/admin/vendor-stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId, productId, quantity }),
    });
    load();
  }

  async function addProduct() {
    if (!addProductId) return;
    await updateQuantity(addProductId, addQty);
    setAddProductId("");
    setAddQty(0);
  }

  const stockedIds = new Set(stock.map((s) => s.product.id));
  const availableToAdd = allProducts.filter((p) => !stockedIds.has(p.id));

  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 12, display: "grid", gap: 8 }}>
      {stock.map((s) => (
        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14 }}>
          <span>{s.product.name} <span style={{ opacity: 0.6 }}>({s.product.price} FCFA)</span></span>
          <input
            type="number"
            min={0}
            value={s.quantity}
            onChange={(e) => updateQuantity(s.product.id, Number(e.target.value))}
            style={{ width: 70, textAlign: "center" }}
          />
        </div>
      ))}
      {!stock.length && <p style={{ opacity: 0.6, fontSize: 13 }}>Ce vendeur n'a encore aucun produit en stock.</p>}

      {!!availableToAdd.length && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} style={{ flex: 1 }}>
            <option value="">— Ajouter un produit —</option>
            {availableToAdd.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input type="number" min={0} value={addQty} onChange={(e) => setAddQty(Number(e.target.value))} style={{ width: 70 }} />
          <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={addProduct}>
            Ajouter
          </button>
        </div>
      )}
    </div>
  );
}

function ProductsTab({ onCount }: { onCount: (n: number) => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", price: "", imageUrl: "", lowStockThreshold: "2" });

  function load() {
    fetch("/api/admin/products?includeArchived=true").then((r) => r.json()).then((d) => {
      const list = d.products || [];
      setProducts(list);
      onCount(list.filter((p: any) => !p.is_archived).length);
    });
  }
  useEffect(load, []);

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        price: Number(form.price),
        imageUrl: form.imageUrl,
        lowStockThreshold: Number(form.lowStockThreshold),
      }),
    });
    setForm({ name: "", price: "", imageUrl: "", lowStockThreshold: "2" });
    load();
  }

  async function archiveProduct(id: string) {
    await fetch(`/api/admin/products/${id}`, { method: "DELETE" });
    load();
  }

  async function restoreProduct(id: string) {
    await fetch(`/api/admin/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isArchived: false }),
    });
    load();
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <form onSubmit={createProduct} className="card" style={{ display: "grid", gap: 10 }}>
        <p style={{ fontWeight: 700 }}>Ajouter un produit au catalogue</p>
        <input placeholder="Nom (ex: Coca-Cola)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input type="number" placeholder="Prix (FCFA)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
        <input placeholder="URL image (optionnel)" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
        {form.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={form.imageUrl}
            alt="Aperçu"
            style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 12, border: "1px solid var(--line)" }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
        )}
        <input type="number" placeholder="Seuil d'alerte stock bas" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} />
        <button className="btn btn-primary" type="submit">Ajouter</button>
      </form>

      <div style={{ display: "grid", gap: 10 }}>
        {products.map((p) => (
          <div key={p.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, opacity: p.is_archived ? 0.55 : 1 }}>
            {p.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.image_url}
                alt={p.name}
                style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 10, flexShrink: 0 }}
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              />
            ) : (
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 10,
                  background: "#f1ede2",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  fontWeight: 700,
                  color: "var(--teal)",
                  flexShrink: 0,
                }}
              >
                {p.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1 }}>
              <strong>{p.name}</strong> — {p.price} FCFA
              {p.is_archived && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#c0392b" }}>Archivé (masqué)</span>
              )}
              <div style={{ fontSize: 12, opacity: 0.6 }}>Seuil d'alerte : {p.low_stock_threshold}</div>
            </div>
            {p.is_archived ? (
              <button className="btn" style={{ fontSize: 12, background: "#e5f5ef", color: "var(--teal)", boxShadow: "none" }} onClick={() => restoreProduct(p.id)}>
                Restaurer
              </button>
            ) : (
              <button className="btn" style={{ fontSize: 12, background: "#fbe4e0", color: "#c0392b", boxShadow: "none" }} onClick={() => archiveProduct(p.id)}>
                Supprimer
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentsTab({ onCount }: { onCount: (n: number) => void }) {
  const [methods, setMethods] = useState<any[]>([]);
  const [form, setForm] = useState({ type: "cash", label: "", merchantLink: "", iconUrl: "", apiKey: "", webhookSecret: "" });

  function load() {
    fetch("/api/admin/payment-methods").then((r) => r.json()).then((d) => {
      const list = d.paymentMethods || [];
      setMethods(list);
      onCount(list.filter((m: any) => m.is_active).length);
    });
  }
  useEffect(load, []);

  async function createMethod(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/admin/payment-methods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ type: "cash", label: "", merchantLink: "", iconUrl: "", apiKey: "", webhookSecret: "" });
    load();
  }

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/admin/payment-methods/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    load();
  }

  async function removeMethod(id: string) {
    await fetch(`/api/admin/payment-methods/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <form onSubmit={createMethod} className="card" style={{ display: "grid", gap: 10 }}>
        <p style={{ fontWeight: 700 }}>Ajouter un mode de paiement</p>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="cash">Liquide</option>
          <option value="wave">Wave</option>
          <option value="orange_money">Orange Money</option>
          <option value="other">Autre</option>
        </select>
        <input placeholder="Nom affiché (ex: Wave)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
        <input placeholder="Lien marchand (optionnel)" value={form.merchantLink} onChange={(e) => setForm({ ...form, merchantLink: e.target.value })} />
        <input placeholder="URL du logo (optionnel, ex: logo Wave)" value={form.iconUrl} onChange={(e) => setForm({ ...form, iconUrl: e.target.value })} />
        {form.iconUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={form.iconUrl}
            alt="Aperçu du logo"
            style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 10, border: "1px solid var(--line)", background: "#fff", padding: 4 }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
        )}
        {form.type === "wave" ? (
          <>
            <input
              placeholder="Clé API Wave (wave_sn_prod_...)"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
            <input
              placeholder="Clé de signature webhook (wave_sn_WHS_...)"
              value={form.webhookSecret}
              onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
            />
            <p style={{ fontSize: 12, opacity: 0.65 }}>
              Enregistre l'URL webhook suivante dans le Business Portal Wave (Développeurs → Webhooks),
              évènement <code>checkout.session.completed</code> (+ <code>payment_failed</code> conseillé) :
              <br />
              <code>{typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/wave</code>
            </p>
          </>
        ) : (
          <input placeholder="Clé API (optionnel, gardée secrète)" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        )}
        <button className="btn btn-primary" type="submit">Ajouter</button>
      </form>

      <div style={{ display: "grid", gap: 10 }}>
        {methods.map((m) => (
          <div key={m.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {m.icon_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.icon_url}
                  alt={m.label}
                  style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 8, background: "#fff", border: "1px solid var(--line)", padding: 3, flexShrink: 0 }}
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: 8, background: "#f1ede2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                  💳
                </div>
              )}
              <div>
                <strong>{m.label}</strong> ({m.type})
                <div style={{ fontSize: 12, opacity: 0.6 }}>{m.is_active ? "Actif" : "Désactivé"}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn" style={{ fontSize: 12, background: "#f1ede2", boxShadow: "none" }} onClick={() => toggleActive(m.id, m.is_active)}>
                {m.is_active ? "Désactiver" : "Activer"}
              </button>
              <button className="btn" style={{ fontSize: 12, background: "#fbe4e0", color: "#c0392b", boxShadow: "none" }} onClick={() => removeMethod(m.id)}>
                Supprimer
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertsTab({ onCount }: { onCount: (n: number) => void }) {
  const [lowStock, setLowStock] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/admin/low-stock").then((r) => r.json()).then((d) => {
      const list = d.lowStock || [];
      setLowStock(list);
      onCount(list.length);
    });
  }, []);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {lowStock.map((row, i) => (
        <div key={i} className="card">
          ⚠ <strong>{row.product?.name}</strong> chez <strong>{row.vendor?.name}</strong> — il reste {row.quantity}
        </div>
      ))}
      {!lowStock.length && <p style={{ opacity: 0.6 }}>Aucune alerte de stock bas actuellement.</p>}
    </div>
  );
}

function ClientsTab({ onCount }: { onCount: (n: number) => void }) {
  const [clients, setClients] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/admin/frequent-clients").then((r) => r.json()).then((d) => {
      const list = d.clients || [];
      setClients(list);
      onCount(list.length);
    });
  }, []);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {clients.map((c, i) => (
        <div key={i} className="card" style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <strong>{c.name}</strong>
            <div style={{ fontSize: 12, opacity: 0.6 }}>{c.phone}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div>{c.orders} commande(s)</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>{c.total} FCFA au total</div>
          </div>
        </div>
      ))}
      {!clients.length && <p style={{ opacity: 0.6 }}>Aucune commande enregistrée pour le moment.</p>}
    </div>
  );
}
