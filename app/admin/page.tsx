"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "vendors" | "products" | "payments" | "alerts" | "clients" | "admins";

const TAB_DEFS: [Tab, string][] = [
  ["vendors", "Vendeurs"],
  ["products", "Produits"],
  ["payments", "Paiements"],
  ["alerts", "Alertes stock"],
  ["clients", "Clients fréquents"],
  ["admins", "Admins"],
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
      <div className="app-header">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Flash Service" />
          <div className="brand-text">
            <strong>Flash Service</strong>
            <span>Administration</span>
          </div>
        </div>
        <button
          className="btn"
          style={{ background: "rgba(255,255,255,0.12)", color: "var(--paper)", boxShadow: "none", fontSize: 13 }}
          onClick={logout}
        >
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
                background: tab === id ? "var(--flash)" : "#f1ede2",
                color: tab === id ? "#fff" : "var(--navy)",
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
      {tab === "admins" && <AdminsTab onCount={(n) => reportCount("admins", n)} />}
    </main>
  );
}

function AdminsTab({ onCount }: { onCount: (n: number) => void }) {
  const [admins, setAdmins] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", password: "" });
  const [error, setError] = useState("");
  const [lastCreatedCode, setLastCreatedCode] = useState("");

  function load() {
    fetch("/api/admin/admins").then((r) => r.json()).then((d) => {
      const list = d.admins || [];
      setAdmins(list);
      onCount(list.length);
    });
  }
  useEffect(load, []);

  async function createAdmin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLastCreatedCode("");
    const res = await fetch("/api/admin/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setForm({ name: "", password: "" });
    setLastCreatedCode(data.admin?.code || "");
    load();
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <form onSubmit={createAdmin} className="card" style={{ display: "grid", gap: 10 }}>
        <p style={{ fontWeight: 700 }}>Créer un compte admin</p>
        <p style={{ fontSize: 12, opacity: 0.7, margin: "-4px 0 0" }}>
          Le code de connexion (ex. ADMK7QX9F) est généré automatiquement, aléatoire et affiché une seule fois
          ci-dessous : note-le tout de suite, il n'est plus jamais réaffiché ensuite. Un compte admin a accès à
          tout (vendeurs, produits, paiements, et peut créer d'autres admins) — ne le communique qu'à une personne
          de confiance, par un canal sûr.
        </p>
        {lastCreatedCode && (
          <p style={{ fontSize: 13, background: "#eaf7ea", border: "1px solid #2e7d32", borderRadius: 6, padding: "6px 10px" }}>
            Compte créé — code de connexion : <strong>{lastCreatedCode}</strong> (à communiquer avec son mot de passe, par un canal sûr)
          </p>
        )}
        <input placeholder="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input
          type="password"
          placeholder="Mot de passe (10 caractères min.)"
          minLength={10}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}
        <button className="btn btn-primary" type="submit">Créer</button>
      </form>

      <div style={{ display: "grid", gap: 10 }}>
        {admins.map((a) => (
          <div key={a.id} className="card">
            <strong>{a.name}</strong> ({a.code})
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              Créé le {new Date(a.created_at).toLocaleDateString("fr-FR")}
              {a.created_by?.name && <> — par {a.created_by.name}</>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VendorsTab({ onCount }: { onCount: (n: number) => void }) {
  const [vendors, setVendors] = useState<any[]>([]);
  const [buildings, setBuildings] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", password: "", buildingId: "", roomNumber: "" });
  const [error, setError] = useState("");
  const [lastCreatedCode, setLastCreatedCode] = useState("");
  const [expandedVendorId, setExpandedVendorId] = useState<string | null>(null);
  const [reassign, setReassign] = useState<Record<string, { buildingId: string; roomNumber: string }>>({});
  const [reassignMessage, setReassignMessage] = useState<Record<string, string>>({});

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
    setLastCreatedCode("");
    const res = await fetch("/api/admin/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, roomNumber: Number(form.roomNumber) }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setForm({ name: "", password: "", buildingId: "", roomNumber: "" });
    setLastCreatedCode(data.vendor?.code || "");
    load();
  }

  async function removeVendor(id: string, name: string) {
    if (!confirm(`Désactiver le vendeur "${name}" ? Il ne pourra plus se connecter ni gérer son stock, mais son historique (commandes, remboursements) est conservé.`)) return;
    const res = await fetch(`/api/admin/vendors/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "Erreur lors de la désactivation.");
    load();
  }

  async function setVendorActive(id: string, isActive: boolean) {
    const res = await fetch(`/api/admin/vendors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "Erreur.");
    load();
  }

  function reassignFieldsFor(v: any) {
    return reassign[v.id] || { buildingId: "", roomNumber: v.room_number ? String(v.room_number) : "" };
  }

  async function saveReassign(v: any) {
    setReassignMessage((m) => ({ ...m, [v.id]: "" }));
    const fields = reassignFieldsFor(v);
    const body: Record<string, unknown> = {};
    if (fields.buildingId) body.buildingId = fields.buildingId;
    if (fields.roomNumber) body.roomNumber = Number(fields.roomNumber);
    if (!body.buildingId && !body.roomNumber) return;

    const res = await fetch(`/api/admin/vendors/${v.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setReassignMessage((m) => ({ ...m, [v.id]: data.error || "Erreur." }));
      return;
    }
    setReassignMessage((m) => ({ ...m, [v.id]: "Mis à jour." }));
    load();
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <form onSubmit={createVendor} className="card" style={{ display: "grid", gap: 10 }}>
        <p style={{ fontWeight: 700 }}>Créer un compte vendeur</p>
        <p style={{ fontSize: 12, opacity: 0.7, margin: "-4px 0 0" }}>
          Le code de connexion (ex. VENK7QX9F) est généré automatiquement, pas besoin de le saisir.
        </p>
        {lastCreatedCode && (
          <p style={{ fontSize: 13, background: "#eaf7ea", border: "1px solid #2e7d32", borderRadius: 6, padding: "6px 10px" }}>
            Compte créé — code de connexion : <strong>{lastCreatedCode}</strong> (à communiquer au vendeur avec son mot de passe)
          </p>
        )}
        <input placeholder="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input type="password" placeholder="Mot de passe" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <div style={{ display: "flex", gap: 8 }}>
          <select value={form.buildingId} onChange={(e) => setForm({ ...form, buildingId: e.target.value })} required style={{ flex: 1 }}>
            <option value="">— Bâtiment —</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={96}
            placeholder="Chambre (1-96)"
            value={form.roomNumber}
            onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
            required
            style={{ width: 130 }}
          />
        </div>
        {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}
        <button className="btn btn-primary" type="submit">Créer</button>
      </form>

      <div style={{ display: "grid", gap: 10 }}>
        {vendors.map((v) => (
          <div key={v.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>{v.name}</strong> ({v.code}) {v.is_active === false && (
                  <span style={{ fontSize: 11, color: "#c0392b", border: "1px solid #c0392b", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>
                    Désactivé
                  </span>
                )}
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  {v.building?.name && v.room_number ? (
                    <>Chambre {v.building.name}-{v.room_number} — {v.is_open ? "Ouvert" : "Fermé"}</>
                  ) : (
                    <span style={{ color: "#c0392b", fontWeight: 600 }}>Bâtiment/chambre non assignés — {v.is_open ? "Ouvert" : "Fermé"}</span>
                  )}
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
                {v.is_active === false ? (
                  <button className="btn" style={{ background: "#e0f0e4", color: "#1e7a34", boxShadow: "none", fontSize: 12 }} onClick={() => setVendorActive(v.id, true)}>
                    Réactiver
                  </button>
                ) : (
                  <button className="btn" style={{ background: "#fbe4e0", color: "#c0392b", boxShadow: "none", fontSize: 12 }} onClick={() => removeVendor(v.id, v.name)}>
                    Supprimer
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <select
                value={reassignFieldsFor(v).buildingId}
                onChange={(e) => setReassign((r) => ({ ...r, [v.id]: { ...reassignFieldsFor(v), buildingId: e.target.value } }))}
                style={{ fontSize: 13 }}
              >
                <option value="">— Changer de bâtiment —</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={96}
                placeholder="Chambre (1-96)"
                value={reassignFieldsFor(v).roomNumber}
                onChange={(e) => setReassign((r) => ({ ...r, [v.id]: { ...reassignFieldsFor(v), roomNumber: e.target.value } }))}
                style={{ width: 130, fontSize: 13 }}
              />
              <button className="btn" style={{ fontSize: 12, boxShadow: "none", background: "#f1ede2" }} onClick={() => saveReassign(v)}>
                Enregistrer
              </button>
              {reassignMessage[v.id] && <span style={{ fontSize: 12, opacity: 0.7 }}>{reassignMessage[v.id]}</span>}
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
  const [rotateFormId, setRotateFormId] = useState<string | null>(null);
  const [rotateValues, setRotateValues] = useState({ apiKey: "", webhookSecret: "" });

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

  // Rotation : remplace la clé API et/ou le secret webhook d'un moyen de
  // paiement existant. Nécessaire après une fuite (ou simplement après le
  // passage au chiffrement V3, pour les valeurs créées avant) : le
  // chiffrement protège une clé au repos, il ne répare pas une clé déjà
  // vue en clair par quelqu'un. Seule une vraie régénération côté Wave,
  // suivie de sa saisie ici, referme la fenêtre d'exposition.
  async function rotateSecrets(id: string) {
    const body: Record<string, string> = {};
    if (rotateValues.apiKey) body.apiKey = rotateValues.apiKey;
    if (rotateValues.webhookSecret) body.webhookSecret = rotateValues.webhookSecret;
    if (!Object.keys(body).length) return;
    await fetch(`/api/admin/payment-methods/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setRotateValues({ apiKey: "", webhookSecret: "" });
    setRotateFormId(null);
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
          <div key={m.id} className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
                {m.type === "wave" && (
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    {m.secret_rotated_at ? (
                      <span style={{ opacity: 0.6 }}>
                        Clés tournées le {new Date(m.secret_rotated_at).toLocaleDateString("fr-FR")}
                      </span>
                    ) : (
                      <span style={{ color: "#c0392b", fontWeight: 600 }}>
                        ⚠ Jamais tournées depuis le passage au chiffrement
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {m.type === "wave" && (
                <button
                  className="btn"
                  style={{ fontSize: 12, background: "#f1ede2", boxShadow: "none" }}
                  onClick={() => setRotateFormId(rotateFormId === m.id ? null : m.id)}
                >
                  {rotateFormId === m.id ? "Fermer" : "Tourner les clés"}
                </button>
              )}
              <button className="btn" style={{ fontSize: 12, background: "#f1ede2", boxShadow: "none" }} onClick={() => toggleActive(m.id, m.is_active)}>
                {m.is_active ? "Désactiver" : "Activer"}
              </button>
              <button className="btn" style={{ fontSize: 12, background: "#fbe4e0", color: "#c0392b", boxShadow: "none" }} onClick={() => removeMethod(m.id)}>
                Supprimer
              </button>
            </div>
          </div>
          {rotateFormId === m.id && (
            <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <p style={{ fontSize: 12, opacity: 0.7 }}>
                Régénère d'abord la clé côté Wave (Business Portal → Développeurs), puis colle la nouvelle
                valeur ici. Laisse un champ vide pour ne pas le changer.
              </p>
              <input
                placeholder="Nouvelle clé API Wave (wave_sn_prod_...)"
                value={rotateValues.apiKey}
                onChange={(e) => setRotateValues({ ...rotateValues, apiKey: e.target.value })}
              />
              <input
                placeholder="Nouveau secret webhook (wave_sn_WHS_...)"
                value={rotateValues.webhookSecret}
                onChange={(e) => setRotateValues({ ...rotateValues, webhookSecret: e.target.value })}
              />
              <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => rotateSecrets(m.id)}>
                Enregistrer la rotation
              </button>
            </div>
          )}
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
