import { useEffect, useRef } from "react";
import { Room } from "colyseus.js";
import { getDefaultLayout } from "./OfficeLayout";

interface Props {
  room: Room;
  meSessionId: string;
  /** Clicar num ponto de alguém → vai até lá (navegação A*). */
  onLocate: (x: number, y: number) => void;
  onClose: () => void;
  /** userId pra destacar (vindo do botão "localizar" da lista). */
  highlightUserId?: string | null;
}

const PANEL_W = 240; // largura do canvas em px

/**
 * Mini-mapa togglável: desenha as salas (contexto) + um ponto por
 * pessoa. O seu ponto fica verde. Clicar num ponto te leva até lá.
 * Atualiza ~4x/s lendo o state do Colyseus (sem re-render do React).
 */
export default function MiniMap({ room, meSessionId, onLocate, onClose, highlightUserId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // dots atuais (px do canvas) → usado no clique/hover pra achar a pessoa
  const dotsRef = useRef<
    Array<{ cx: number; cy: number; x: number; y: number; me: boolean; name: string; userId: string }>
  >([]);
  const hoverRef = useRef<{ cx: number; cy: number; name: string } | null>(null);
  const highlightRef = useRef<string | null>(highlightUserId ?? null);
  highlightRef.current = highlightUserId ?? null;

  const layout = getDefaultLayout();
  const scale = PANEL_W / layout.width;
  const panelH = Math.round(layout.height * scale);

  useEffect(() => {
    const draw = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      // fundo
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, cv.width, cv.height);

      // salas (contexto)
      ctx.strokeStyle = "#334155";
      ctx.fillStyle = "#1e293b";
      ctx.lineWidth = 1;
      for (const r of layout.rooms) {
        const x = r.x * scale;
        const y = r.y * scale;
        const w = r.w * scale;
        const h = r.h * scale;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }

      // pessoas
      const dots: typeof dotsRef.current = [];
      const state: any = room.state;
      const hl = highlightRef.current;
      const t = Date.now();
      state?.players?.forEach?.((p: any, sid: string) => {
        const cx = p.x * scale;
        const cy = p.y * scale;
        const me = sid === meSessionId;
        const uid = p.userId || "";
        dots.push({ cx, cy, x: p.x, y: p.y, me, name: p.name || "?", userId: uid });
        ctx.beginPath();
        ctx.arc(cx, cy, me ? 5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = me ? "#4ade80" : "#38bdf8";
        ctx.fill();
        ctx.strokeStyle = "#0b1220";
        ctx.lineWidth = 1;
        ctx.stroke();
        if (me) {
          ctx.strokeStyle = "#4ade80";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Destaque (botão "localizar" da lista): anel pulsante laranja
        if (hl && uid === hl) {
          const pulse = 9 + Math.sin(t / 180) * 4;
          ctx.strokeStyle = "#fb923c";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      dotsRef.current = dots;

      // Tooltip de nome (hover)
      const hov = hoverRef.current;
      if (hov) {
        ctx.font = "11px system-ui, -apple-system";
        const tw = ctx.measureText(hov.name).width;
        let bx = hov.cx + 8;
        let by = hov.cy - 10;
        if (bx + tw + 8 > cv.width) bx = hov.cx - tw - 16;
        if (by < 2) by = hov.cy + 8;
        ctx.fillStyle = "#000000cc";
        ctx.fillRect(bx, by, tw + 8, 16);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(hov.name, bx + 4, by + 12);
      }
    };
    draw();
    const id = window.setInterval(draw, 250);
    return () => window.clearInterval(id);
  }, [room, meSessionId, scale]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * cv.width;
    const py = ((e.clientY - rect.top) / rect.height) * cv.height;
    // pessoa mais próxima do clique (raio de 14px no canvas)
    let best: { x: number; y: number; d2: number } | null = null;
    for (const d of dotsRef.current) {
      if (d.me) continue;
      const dd = (d.cx - px) ** 2 + (d.cy - py) ** 2;
      if (dd < 14 * 14 && (!best || dd < best.d2)) best = { x: d.x, y: d.y, d2: dd };
    }
    if (best) onLocate(best.x, best.y);
  }

  function handleMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * cv.width;
    const py = ((e.clientY - rect.top) / rect.height) * cv.height;
    let best: { cx: number; cy: number; name: string; d2: number } | null = null;
    for (const d of dotsRef.current) {
      const dd = (d.cx - px) ** 2 + (d.cy - py) ** 2;
      if (dd < 16 * 16 && (!best || dd < best.d2)) {
        best = { cx: d.cx, cy: d.cy, name: d.me ? `${d.name} (você)` : d.name, d2: dd };
      }
    }
    hoverRef.current = best ? { cx: best.cx, cy: best.cy, name: best.name } : null;
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>🧭 Mini-mapa</span>
        <button onClick={onClose} style={closeBtn} title="Fechar">✕</button>
      </div>
      <canvas
        ref={canvasRef}
        width={PANEL_W}
        height={panelH}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => { hoverRef.current = null; }}
        style={{ display: "block", borderRadius: 6, cursor: "pointer", width: PANEL_W, height: panelH }}
      />
      <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>
        Verde = você. Clique num ponto pra ir até a pessoa.
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  zIndex: 14,
  background: "#0f172af2",
  border: "1px solid #334155",
  borderRadius: 10,
  padding: 10,
  color: "#e2e8f0",
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 6,
};
const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#94a3b8",
  cursor: "pointer",
  fontSize: 14,
};
