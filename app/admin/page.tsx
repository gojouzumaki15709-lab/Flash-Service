"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "vendors" | "products" | "payments" | "alerts" | "clients";

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("vendors");

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
        {([
          ["vendors", "Vendeurs"],
          ["products", "Produits"],
          ["payments", "Paiements"],
          ["alerts", "Alertes stock"],
          ["clients", "Clients fréquents"],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            className="btn"
            style={{
              fontSize: 12,
              padding: "8px 14px",
              background: tab === id ? "var(--teal)" : "#f1ede2",
              color: tab === id ? "#fff" : "var(--ink)",
              boxShadow: "none",
            }}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "vendors" && <VendorsTab />}
      {tab === "products" && <ProductsTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "alerts" && <AlertsTab />}
      {tab === "clients" && <ClientsTab />}
    </main>
  );
}

function VendorsTab() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [buildings, setBuildings] = useState<any[]>([]);
  const [form, setForm] = useState({ code: "", name: "", password: "", buildingId: "" });
  const [error, setError] = useState("");

  function load() {
    fetch("/api/admin/vendors").then((r) => r.json()).then((d) => setVendors(d.vendors || []));
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

function ProductsTab() {
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", price: "", imageUrl: "", lowStockThreshold: "2" });

  function load() {
    fetch("/api/admin/products").then((r) => r.json()).then((d) => setProducts(d.products || []));
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
        <input type="number" placeholder="Seuil d'alerte stock bas" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} />
        <button className="btn btn-primary" type="submit">Ajouter</button>
      </form>

      <div style={{ display: "grid", gap: 10 }}>
        {products.map((p) => (
          <div key={p.id} className="card">
            <strong>{p.name}</strong> — {p.price} FCFA
            <div style={{ fontSize: 12, opacity: 0.6 }}>Seuil d'alerte : {p.low_stock_threshold}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentsTab() {
  const [methods, setMethods] = useState<any[]>([]);
  const [form, setForm] = useState({ type: "cash", label: "", merchantLink: "", apiKey: "" });

  function load() {
    fetch("/api/admin/payment-methods").then((r) => r.json()).then((d) => setMethods(d.paymentMethods || []));
  }
  useEffect(load, []);

  async function createMethod(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/admin/payment-methods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ type: "cash", label: "", merchantLink: "", apiKey: "" });
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
        <input placeholder="Clé API (optionnel, gardée secrète)" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        <button className="btn btn-primary" type="submit">Ajouter</button>
      </form>

      <div style={{ display: "grid", gap: 10 }}>
        {methods.map((m) => (
          <div key={m.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{m.label}</strong> ({m.type})
              <div style={{ fontSize: 12, opacity: 0.6 }}>{m.is_active ? "Actif" : "Désactivé"}</div>
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

function AlertsTab() {
  const [lowStock, setLowStock] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/admin/low-stock").then((r) => r.json()).then((d) => setLowStock(d.lowStock || []));
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

function ClientsTab() {
  const [clients, setClients] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/admin/frequent-clients").then((r) => r.json()).then((d) => setClients(d.clients || []));
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
