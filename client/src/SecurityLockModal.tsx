import { useEffect, useRef, useState } from "react";

/**
 * Painel de fechadura eletrônica da Sala de Segurança.
 * Aparece quando a pessoa tenta entrar (server manda `security:locked`).
 * Tem teclado numérico + leitor de digital. Qualquer tentativa →
 * "ACESSO NEGADO" (a sala é restrita; não existe senha que abra).
 */
export default function SecurityLockModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [denied, setDenied] = useState(false);
  const denyTimer = useRef<number | undefined>(undefined);

  const deny = () => {
    setDenied(true);
    if (denyTimer.current) window.clearTimeout(denyTimer.current);
    denyTimer.current = window.setTimeout(() => {
      setDenied(false);
      setCode("");
    }, 1600);
  };

  const press = (d: string) => {
    if (denied) return;
    const next = (code + d).slice(0, 6);
    setCode(next);
    if (next.length >= 4) deny(); // 4+ dígitos → tenta validar → nega
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key >= "0" && e.key <= "9") press(e.key);
      else if (e.key === "Enter" || e.key === "Backspace") deny();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (denyTimer.current) window.clearTimeout(denyTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, denied]);

  const accent = denied ? "#ef4444" : "#22d3ee";

  return (
    <div style={overlay} onClick={onClose}>
      <style>{`@keyframes voShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}`}</style>
      <div
        style={{ ...panel, animation: denied ? "voShake 0.4s" : undefined, borderColor: accent }}
        onClick={(e) => e.stopPropagation()}
      >
        <button style={closeBtn} onClick={onClose} title="Fechar">✕</button>
        <div style={{ fontSize: 12, letterSpacing: 2, color: "#94a3b8", marginBottom: 4 }}>
          🔒 SALA DE SEGURANÇA
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
          Área restrita — acesso controlado
        </div>

        {/* Display */}
        <div
          style={{
            ...display,
            color: accent,
            borderColor: accent,
            textShadow: `0 0 8px ${accent}`,
          }}
        >
          {denied ? "ACESSO NEGADO" : (code.replace(/./g, "•").padEnd(6, "‒") || "‒‒‒‒‒‒")}
        </div>

        {/* Teclado */}
        <div style={grid}>
          {["1","2","3","4","5","6","7","8","9"].map((d) => (
            <button key={d} style={key} onClick={() => press(d)}>{d}</button>
          ))}
          <button style={{ ...key, visibility: "hidden" }} disabled>·</button>
          <button style={key} onClick={() => press("0")}>0</button>
          <button style={{ ...key, color: "#f87171" }} onClick={deny} title="Limpar/Confirmar">⌫</button>
        </div>

        {/* Leitor de digital */}
        <button
          style={{ ...fingerprint, color: accent, borderColor: accent }}
          onClick={deny}
          title="Leitor biométrico"
        >
          <span style={{ fontSize: 30, lineHeight: 1 }}>🫆</span>
          <span style={{ fontSize: 10, letterSpacing: 1 }}>
            {denied ? "DIGITAL NÃO RECONHECIDA" : "ENCOSTE O DEDO"}
          </span>
        </button>

        <div style={{ fontSize: 10, color: "#64748b", marginTop: 10, textAlign: "center" }}>
          Somente a equipe de Segurança tem acesso.
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 120,
  background: "#000a", backdropFilter: "blur(2px)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 16,
};
const panel: React.CSSProperties = {
  position: "relative",
  width: "min(300px, 100%)",
  background: "linear-gradient(180deg,#0b1220,#111827)",
  border: "2px solid #22d3ee",
  borderRadius: 16,
  padding: "22px 20px 18px",
  boxShadow: "0 20px 60px #000a, 0 0 0 4px #0f172a",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#e2e8f0",
};
const closeBtn: React.CSSProperties = {
  position: "absolute", top: 8, right: 8,
  width: 26, height: 26, borderRadius: 6,
  background: "#1e293b", border: "1px solid #334155",
  color: "#94a3b8", cursor: "pointer", fontSize: 13,
};
const display: React.CSSProperties = {
  fontFamily: "ui-monospace, 'Courier New', monospace",
  fontSize: 22, fontWeight: 700, letterSpacing: 3,
  textAlign: "center", padding: "12px 8px", marginBottom: 16,
  background: "#020617", border: "1px solid", borderRadius: 8,
  minHeight: 26,
};
const grid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14,
};
const key: React.CSSProperties = {
  padding: "12px 0", fontSize: 18, fontWeight: 700,
  background: "#1e293b", border: "1px solid #334155",
  borderRadius: 8, color: "#e2e8f0", cursor: "pointer",
};
const fingerprint: React.CSSProperties = {
  width: "100%", display: "flex", flexDirection: "column",
  alignItems: "center", gap: 4, padding: "10px 0",
  background: "#0b1220", border: "1px dashed", borderRadius: 10,
  cursor: "pointer",
};
