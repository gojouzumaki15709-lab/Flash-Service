"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "client" | "vendor" | "admin";

const ROLE_LABEL: Record<Role, string> = {
  client: "Je suis client",
  vendor: "Je suis vendeur",
  admin: "Je suis administrateur",
};

export default function Home() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("client");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const url =
        mode === "register" ? "/api/auth/register-client" : "/api/auth/login";
      const body =
        mode === "register"
          ? { phone: identifier, name, password }
          : { role, identifier, password };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        <div
          className="display"
          style={{ fontSize: 34, color: "var(--teal)", lineHeight: 1 }}
        >
          🍬 Sucrerie
        </div>
        <p style={{ color: "var(--ink)", opacity: 0.7, marginTop: 6 }}>
          Trouve un vendeur ouvert dans ton bâtiment
        </p>
      </div>

      <div className="card" style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRole(r);
                setMode("login");
                setError("");
              }}
              className="btn"
              style={{
                flex: 1,
                fontSize: 12,
                padding: "9px 6px",
                background: role === r ? "var(--teal)" : "#f1ede2",
                color: role === r ? "#fff" : "var(--ink)",
                boxShadow: "none",
              }}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "register" && (
            <div>
              <label className="label">Nom complet</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}

          <div>
            <label className="label">
              {role === "client" ? "Numéro de téléphone" : "Code"}
            </label>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={role === "client" ? "07 00 00 00 00" : "Ton code"}
              required
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

          {error && (
            <p style={{ color: "#c0392b", fontSize: 13, fontWeight: 600 }}>{error}</p>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "..." : mode === "register" ? "Créer mon compte" : "Se connecter"}
          </button>
        </form>

        {role === "client" && (
          <p style={{ textAlign: "center", marginTop: 14, fontSize: 13 }}>
            {mode === "login" ? (
              <>
                Pas encore de compte ?{" "}
                <button
                  className="btn"
                  style={{ background: "none", boxShadow: "none", padding: 0, color: "var(--mango-dark)", fontWeight: 700 }}
                  onClick={() => setMode("register")}
                  type="button"
                >
                  S'inscrire
                </button>
              </>
            ) : (
              <>
                Déjà un compte ?{" "}
                <button
                  className="btn"
                  style={{ background: "none", boxShadow: "none", padding: 0, color: "var(--mango-dark)", fontWeight: 700 }}
                  onClick={() => setMode("login")}
                  type="button"
                >
                  Se connecter
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </main>
  );
}
