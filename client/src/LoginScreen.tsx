import { useState } from "react";
import { login, register, loginVisitor, AuthSession } from "./auth";

interface Props {
  httpUrl: string;
  onAuthed: (session: AuthSession) => void;
}

type Mode = "login" | "register" | "visitor";

export default function LoginScreen({ httpUrl, onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [vcode, setVcode] = useState("");
  const [vpass, setVpass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError("");

    if (mode === "visitor") {
      if (!displayName.trim()) {
        setError("Digite seu nome");
        return;
      }
      if (!vcode.trim() && !vpass) {
        setError("Informe o código de convite ou a senha de visitante");
        return;
      }
      setLoading(true);
      try {
        const session = await loginVisitor(httpUrl, {
          name: displayName.trim(),
          code: vcode.trim() || undefined,
          password: vpass || undefined,
        });
        onAuthed(session);
      } catch (e: any) {
        setError(e?.message || "Falha ao entrar como visitante");
      } finally {
        setLoading(false);
      }
      return;
    }

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
      if (password !== confirmPassword) {
        setError("As senhas não conferem");
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
          {mode === "login"
            ? "Entrar na sua conta"
            : mode === "register"
            ? "Criar uma conta nova"
            : "Entrar como visitante (convidado)"}
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
          <button
            onClick={() => setMode("visitor")}
            style={{ ...tabStyle, ...(mode === "visitor" ? tabActiveStyle : {}) }}
            disabled={loading}
          >
            Visitante
          </button>
        </div>

        {mode !== "visitor" && (
          <>
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
                <label style={labelStyle}>Confirmar senha</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Repita a senha"
                  style={inputStyle}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </>
            )}
          </>
        )}

        {(mode === "register" || mode === "visitor") && (
          <>
            <label style={labelStyle}>{mode === "visitor" ? "Seu nome" : "Nome de exibição"}</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Como os outros vão te ver"
              style={inputStyle}
              disabled={loading}
              maxLength={24}
              autoFocus={mode === "visitor"}
            />
          </>
        )}

        {mode === "visitor" && (
          <>
            <label style={labelStyle}>Código de convite</label>
            <input
              value={vcode}
              onChange={(e) => setVcode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Ex: A1B2C3 (peça pra quem te convidou)"
              style={inputStyle}
              disabled={loading}
              maxLength={6}
            />
            <p style={{ margin: "6px 0 0", fontSize: 12, opacity: 0.6, textAlign: "center" }}>
              — ou —
            </p>
            <label style={labelStyle}>Senha de visitante</label>
            <input
              type="password"
              value={vpass}
              onChange={(e) => setVpass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Senha compartilhada (se você tiver)"
              style={inputStyle}
              disabled={loading}
            />
          </>
        )}

        <button onClick={submit} disabled={loading} style={{ ...buttonStyle, marginTop: 16 }}>
          {loading
            ? "Aguarde..."
            : mode === "login"
            ? "Entrar"
            : mode === "register"
            ? "Criar conta"
            : "Entrar como visitante"}
        </button>

        {error && <p style={{ color: "#f87171", marginTop: 16, fontSize: 13 }}>{error}</p>}

        <p style={{ marginTop: 16, fontSize: 12, opacity: 0.6, textAlign: "center" }}>
          {mode === "visitor" ? (
            <>
              É do escritório?{" "}
              <a onClick={() => setMode("login")} style={linkStyle}>
                Entrar com conta
              </a>
            </>
          ) : mode === "login" ? (
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
  height: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(135deg, #0f172a, #1e293b)",
  overflowY: "auto",
  padding: 16,
};
const cardStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 12,
  padding: 28,
  // Fluido: nunca estoura em telas estreitas
  width: "min(380px, 100%)",
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
