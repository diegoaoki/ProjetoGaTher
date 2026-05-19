import { useState } from "react";

/**
 * Editor da própria mesa (dono): escolhe o modelo + decoração.
 * Listas espelham ALLOWED_DESK_TEX / ALLOWED_DESK_DECOR do server
 * (OfficeRoom). Salva via onSave(tex, decor) → room.send("desk:customize").
 */

// "" = modelo padrão (mesa procedural — sem PNG). Os demais têm PNG em
// /assets/interiors/desks/<tex>.png.
const MODELS: { tex: string; label: string }[] = [
  { tex: "", label: "Padrão" },
  { tex: "desk_work", label: "Madeira larga" },
  { tex: "desk_pc1", label: "Madeira + PC" },
  { tex: "desk_pc2", label: "Cinza + PC" },
  { tex: "desk_screen1", label: "Madeira + tela" },
  { tex: "desk_screen2", label: "Cinza + tela" },
  { tex: "desk_long", label: "Bancada" },
  { tex: "desk_office", label: "Escritório" },
  { tex: "desk_plain", label: "Lisa" },
  { tex: "desk_wide", label: "Larga" },
];

const DECOR: { type: string; label: string }[] = [
  { type: "monitor", label: "Monitor" },
  { type: "plant", label: "Planta" },
  { type: "printer", label: "Impressora" },
];

interface Props {
  currentTex: string;
  currentDecor: string[];
  saving: boolean;
  error: string;
  onSave: (tex: string, decor: string[]) => void;
  onClose: () => void;
}

export default function DeskEditor({ currentTex, currentDecor, saving, error, onSave, onClose }: Props) {
  const [tex, setTex] = useState(MODELS.some((m) => m.tex === currentTex) ? currentTex : "");
  const [decor, setDecor] = useState<string[]>(
    currentDecor.filter((d) => DECOR.some((x) => x.type === d))
  );

  function toggle(type: string) {
    setDecor((d) => (d.includes(type) ? d.filter((x) => x !== type) : [...d, type]));
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>✏️ Editar mesa</h2>
      <p style={{ margin: "0 0 12px", fontSize: 12, opacity: 0.7 }}>
        Personalize sua estação. Todos veem.
      </p>

      <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Modelo</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
          gap: 6,
          maxHeight: 220,
          overflowY: "auto",
          padding: 4,
          background: "#0b1220",
          border: "1px solid #334155",
          borderRadius: 8,
          marginBottom: 14,
        }}
      >
        {MODELS.map((m) => {
          const sel = tex === m.tex;
          return (
            <button
              key={m.tex || "__default__"}
              onClick={() => setTex(m.tex)}
              title={m.label}
              style={{
                background: sel ? "#1d4ed8" : "#1e293b",
                border: sel ? "2px solid #60a5fa" : "1px solid #334155",
                borderRadius: 6, padding: 4, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              }}
            >
              <div
                style={{
                  width: 56, height: 40, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  background: "#0f172a", borderRadius: 4, overflow: "hidden",
                }}
              >
                {m.tex ? (
                  <img
                    src={`/assets/interiors/desks/${m.tex}.png`}
                    alt={m.label}
                    style={{ maxWidth: "100%", maxHeight: "100%", imageRendering: "pixelated" }}
                  />
                ) : (
                  <span style={{ fontSize: 16 }}>🪑</span>
                )}
              </div>
              <span style={{ fontSize: 10, color: "#e2e8f0", textAlign: "center" }}>{m.label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Decoração</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        {DECOR.map((d) => {
          const on = decor.includes(d.type);
          return (
            <button
              key={d.type}
              onClick={() => toggle(d.type)}
              style={{
                background: on ? "#1d4ed8" : "#1e293b",
                border: on ? "2px solid #60a5fa" : "1px solid #334155",
                color: "#e2e8f0", borderRadius: 999, padding: "6px 12px",
                cursor: "pointer", fontSize: 12,
              }}
            >
              {on ? "✓ " : ""}{d.label}
            </button>
          );
        })}
      </div>

      {error && <p style={{ color: "#f87171", marginTop: 10, fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button
          onClick={() => onSave(tex, decor)}
          disabled={saving}
          style={{
            flex: 1, background: "#2563eb", border: "none", color: "#fff",
            borderRadius: 8, padding: "10px 0", cursor: saving ? "default" : "pointer",
            fontSize: 14, opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button
          onClick={onClose}
          disabled={saving}
          style={{
            background: "#334155", border: "none", color: "#e2e8f0",
            borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontSize: 14,
          }}
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
