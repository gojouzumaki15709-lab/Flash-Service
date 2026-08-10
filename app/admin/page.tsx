"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "vendors" | "products" | "payments" | "alerts" | "clients";

const TAB_DEFS: [Tab, string][] = [
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
        <h1 className="display" style={{ fontSize: 24, color: "var(--teal)" }}>Administration</h1>
        <button className="btn" style={{ background: "#f1ede2", boxShadow: "none", fontSize: 13 }} onClick={logout}>
          Déconnexion
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {TAB_DEFS.map(([id, label]) => {
          const count = counts[id];
          const isAlerts = id === "alerts" && !!count;
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
                  className={`badge ${isAlerts ? "badge-danger" : "badge-neutral"}`}
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

      {tab === "vendors" && <VendorsTab onCount={(n) => reportCount("vendors", n)} />}
      {tab === "products" && <ProductsTab onCount={(n) => reportCount("products", n)} />}
      {tab === "payments" && <PaymentsTab onCount={(n) => reportCount("payments", n)} />}
      {tab === "alerts" && <AlertsTab onCount={(n) => reportCount("alerts", n)} />}
      {tab === "clients" && <ClientsTab onCount={(n) => reportCount("clients", n)} />}
    </main>
  );
}

function VendorsTab({ onCount }: { onCount: (n: number) => void }) {
  const [vendors, setVendors] = useState<any[]>([]);
  const [buildings, setBuildings] = useState<any[]>([]);
  const [form, setForm] = useState({ code: "", name: "", password: "", buildingId: "" });
  const [error, setError] = useState("");

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
        <input type="password" placeholder="Mot de passe" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
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
          <div key={v.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{v.name}</strong> ({v.code})
              <div style={{ fontSize: 13, opacity: 0.7 }}>
                Bâtiment {v.building?.letter}{v.building?.number} — {v.is_open ? "Ouvert" : "Fermé"}
              </div>
            </div>
            <button className="btn" style={{ background: "#fbe4e0", color: "#c0392b", boxShadow: "none", fontSize: 12 }} onClick={() => removeVendor(v.id)}>
              Supprimer
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductsTab({ onCount }: { onCount: (n: number) => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", price: "", imageUrl: "", lowStockThreshold: "2" });

  function load() {
    fetch("/api/admin/products").then((r) => r.json()).then((d) => {
      const list = d.products || [];
      setProducts(list);
      onCount(list.length);
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
          <div key={p.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                  fontSize: 20,
                  flexShrink: 0,
                }}
              >
                🍬
              </div>
            )}
            <div>
              <strong>{p.name}</strong> — {p.price} FCFA
              <div style={{ fontSize: 12, opacity: 0.6 }}>Seuil d'alerte : {p.low_stock_threshold}</div>
            </div>
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
