import { useState } from "react";
import { login, register, AuthSession } from "./auth";

interface Props {
  httpUrl: string;
  onAuthed: (session: AuthSession) => void;
}

type Mode = "login" | "register";

export default function LoginScreen({ httpUrl, onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError("");

    if (!email.trim() || !password) {
      setError("Preencha email e senha");
      return;
    }

    if (mode === "register") {
      if (!displayName.trim()) {
        setError("Digite um nome de exibição");
        return;
      }
      if (password.length < 8) {
        setError("Senha precisa ter ao menos 8 caracteres");
        return;
      }
    }

    setLoading(true);
    try {
      const session =
        mode === "login"
          ? await login(httpUrl, { email: email.trim(), password })
          : await register(httpUrl, {
              email: email.trim(),
              password,
              displayName: displayName.trim(),
            });
      onAuthed(session);
    } catch (e: any) {
      setError(e?.message || "Falha na autenticação");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <h1 style={{ margin: "0 0 4px", fontSize: 28 }}>Virtual Office</h1>
        <p style={{ margin: "0 0 20px", opacity: 0.7, fontSize: 14 }}>
          {mode === "login" ? "Entrar na sua conta" : "Criar uma conta nova"}
        </p>

        <div style={tabsStyle}>
          <button
            onClick={() => setMode("login")}
            style={{ ...tabStyle, ...(mode === "login" ? tabActiveStyle : {}) }}
            disabled={loading}
          >
            Entrar
          </button>
          <button
            onClick={() => setMode("register")}
            style={{ ...tabStyle, ...(mode === "register" ? tabActiveStyle : {}) }}
            disabled={loading}
          >
            Cadastrar
          </button>
        </div>

        <label style={labelStyle}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="seu@email.com"
          style={inputStyle}
          disabled={loading}
          autoComplete="email"
          autoFocus
        />

        <label style={labelStyle}>Senha</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={mode === "register" ? "Mínimo 8 caracteres" : "Sua senha"}
          style={inputStyle}
          disabled={loading}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />

        {mode === "register" && (
          <>
            <label style={labelStyle}>Nome de exibição</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Como os outros vão te ver"
              style={inputStyle}
              disabled={loading}
              maxLength={24}
            />
          </>
        )}

        <button onClick={submit} disabled={loading} style={{ ...buttonStyle, marginTop: 16 }}>
          {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
        </button>

        {error && <p style={{ color: "#f87171", marginTop: 16, fontSize: 13 }}>{error}</p>}

        <p style={{ marginTop: 16, fontSize: 12, opacity: 0.6, textAlign: "center" }}>
          {mode === "login" ? (
            <>
              Não tem conta?{" "}
              <a onClick={() => setMode("register")} style={linkStyle}>
                Cadastre-se
              </a>
            </>
          ) : (
            <>
              Já tem conta?{" "}
              <a onClick={() => setMode("login")} style={linkStyle}>
                Entrar
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  width: "100vw",
  height: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(135deg, #0f172a, #1e293b)",
  overflowY: "auto",
};
const cardStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 12,
  padding: 28,
  width: 380,
  boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
};
const tabsStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: 20,
  background: "#0f172a",
  padding: 4,
  borderRadius: 8,
};
const tabStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  border: "none",
  background: "transparent",
  color: "#94a3b8",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  borderRadius: 6,
};
const tabActiveStyle: React.CSSProperties = {
  background: "#334155",
  color: "#e2e8f0",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  marginBottom: 6,
  marginTop: 12,
  opacity: 0.8,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "#e2e8f0",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};
const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "#4ade80",
  color: "#052e16",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
const linkStyle: React.CSSProperties = {
  color: "#60a5fa",
  cursor: "pointer",
  textDecoration: "underline",
};
