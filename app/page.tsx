"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 96,
            height: 96,
            borderRadius: 26,
            background: "var(--navy)",
            backgroundImage: "linear-gradient(135deg, var(--navy), var(--navy-deep))",
            marginBottom: 14,
            boxShadow: "0 10px 0 var(--navy-deep)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Flash Service" style={{ width: 62, height: 62, objectFit: "contain" }} />
        </div>
        <h1 style={{ fontSize: 26, letterSpacing: "-0.01em" }}>
          Flash <span style={{ color: "var(--flash-deep)" }}>Service</span>
        </h1>
        <p style={{ color: "var(--navy)", opacity: 0.65, marginTop: 6, fontSize: 14 }}>
          Trouve un vendeur ouvert dans ton bâtiment
        </p>
      </div>

      <div className="card-ticket" style={{ width: "100%", maxWidth: 400 }}>
        <div className="flash-rule" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {mode === "login" ? "Connexion" : "Inscription"}
        </div>

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
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && <p style={{ color: "#c0392b", fontSize: 13, fontWeight: 600 }}>{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "..." : "Se connecter"}
            </button>

            <hr className="ticket-divider" />

            <p style={{ textAlign: "center", fontSize: 13 }}>
              Pas encore connecté ?{" "}
              <button
                className="btn"
                style={{ background: "none", boxShadow: "none", padding: 0, color: "var(--flash-deep)", fontWeight: 700 }}
                onClick={() => {
                  setMode("register");
                  setError("");
                }}
                type="button"
              >
                Rejoins l'aventure avec Flash Service
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
              <input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} required />
            </div>

            {error && <p style={{ color: "#c0392b", fontSize: 13, fontWeight: 600 }}>{error}</p>}

            <button type="submit" className="btn btn-accent" disabled={loading}>
              {loading ? "..." : "Créer mon compte"}
            </button>

            <hr className="ticket-divider" />

            <p style={{ textAlign: "center", fontSize: 13 }}>
              Déjà un compte ?{" "}
              <button
                className="btn"
                style={{ background: "none", boxShadow: "none", padding: 0, color: "var(--flash-deep)", fontWeight: 700 }}
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

      <p style={{ marginTop: 18, fontSize: 12, opacity: 0.45, fontFamily: "var(--font-mono)" }}>
        service de vente · sucreries fraîches
      </p>
    </main>
  );
}
