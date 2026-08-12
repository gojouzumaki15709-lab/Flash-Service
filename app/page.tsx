"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "./components/PasswordInput";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");

  // connexion
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  // inscription (client uniquement)
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [regPassword, setRegPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Une erreur est survenue.");
        return;
      }
      router.push(data.redirect);
    } finally {
      setLoading(false);
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, phone, name, password: regPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Une erreur est survenue.");
        return;
      }
      router.push(data.redirect);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background:
          "radial-gradient(circle at 15% 10%, rgba(255,138,61,0.16), transparent 40%), radial-gradient(circle at 85% 90%, rgba(15,110,95,0.14), transparent 45%), var(--paper)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="Flash Service"
          style={{ width: 108, height: 108, borderRadius: 24, marginBottom: 8 }}
        />
        <p style={{ color: "var(--ink)", opacity: 0.7, marginTop: 6 }}>
          Trouve un vendeur ouvert dans ton bâtiment
        </p>
      </div>

      <div className="card" style={{ width: "100%", maxWidth: 400 }}>
        {mode === "login" ? (
          <form onSubmit={submitLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="label">Nom d'utilisateur</label>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Ton identifiant"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="label">Mot de passe</label>
              <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" required />
            </div>

            {error && <p style={{ color: "#c0392b", fontSize: 13, fontWeight: 600 }}>{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "..." : "Se connecter"}
            </button>

            <p style={{ textAlign: "center", marginTop: 4, fontSize: 13 }}>
              Pas encore de compte ?{" "}
              <button
                className="btn"
                style={{ background: "none", boxShadow: "none", padding: 0, color: "var(--mango-dark)", fontWeight: 700 }}
                onClick={() => {
                  setMode("register");
                  setError("");
                }}
                type="button"
              >
                Appuie ici et rejoins l'aventure avec Flash Service
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={submitRegister} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="label">Nom complet</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>

            <div>
              <label className="label">Nom d'utilisateur</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Choisis un identifiant" required />
            </div>

            <div>
              <label className="label">Numéro de téléphone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07 00 00 00 00" required />
            </div>

            <div>
              <label className="label">Mot de passe</label>
              <PasswordInput value={regPassword} onChange={setRegPassword} autoComplete="new-password" required />
            </div>

            {error && <p style={{ color: "#c0392b", fontSize: 13, fontWeight: 600 }}>{error}</p>}

            <button type="submit" className="btn btn-accent" disabled={loading}>
              {loading ? "..." : "Créer mon compte"}
            </button>

            <p style={{ textAlign: "center", marginTop: 4, fontSize: 13 }}>
              Déjà un compte ?{" "}
              <button
                className="btn"
                style={{ background: "none", boxShadow: "none", padding: 0, color: "var(--mango-dark)", fontWeight: 700 }}
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
                type="button"
              >
                Se connecter
              </button>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
