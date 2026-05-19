import { useEffect, useRef } from "react";
import { Room } from "colyseus.js";
import { getDefaultLayout, FLOOR2_Y0 } from "./OfficeLayout";
import { useDraggable } from "./useDraggable";

interface Props {
  room: Room;
  meSessionId: string;
  /** Clicar num ponto de alguém → vai até lá (navegação A*). */
  onLocate: (x: number, y: number) => void;
  onClose: () => void;
  /** userId pra destacar (vindo do botão "localizar" da lista). */
  highlightUserId?: string | null;
  /** Andar atual — o mini-mapa só mostra o andar onde você está. */
  myFloor?: number;
}

const PANEL_W = 240; // largura do canvas em px

/**
 * Mini-mapa togglável: desenha as salas (contexto) + um ponto por
 * pessoa. O seu ponto fica verde. Clicar num ponto te leva até lá.
 * Atualiza ~4x/s lendo o state do Colyseus (sem re-render do React).
 */
export default function MiniMap({ room, meSessionId, onLocate, onClose, highlightUserId, myFloor = 1 }: Props) {
  const drag = useDraggable();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // dots atuais (px do canvas) → usado no clique/hover pra achar a pessoa
  const dotsRef = useRef<
    Array<{ cx: number; cy: number; x: number; y: number; me: boolean; name: string; userId: string; photo: string }>
  >([]);
  // Cache de fotos de perfil (data URL → Image) pro mini-mapa.
  const photoCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const hoverRef = useRef<{ cx: number; cy: number; name: string; photo: string } | null>(null);
  const highlightRef = useRef<string | null>(highlightUserId ?? null);
  highlightRef.current = highlightUserId ?? null;

  const layout = getDefaultLayout();
  // Só o andar atual (outra "dimensão" — não revela o outro andar).
  // 2º andar = retângulo da própria sala (sem margem vazia em volta).
  const f2 = layout.rooms.find((r) => r.id === "floor2");
  const region =
    myFloor === 2 && f2
      ? { x: f2.x - 32, y: f2.y - 32, w: f2.w + 64, h: f2.h + 64 }
      : { x: 0, y: 0, w: layout.width, h: 55 * 32 };
  const scale = PANEL_W / region.w;
  const panelH = Math.round(region.h * scale);

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
        const rFloor = r.y >= FLOOR2_Y0 ? 2 : 1;
        if (rFloor !== myFloor) continue; // só o andar atual
        const x = (r.x - region.x) * scale;
        const y = (r.y - region.y) * scale;
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
        if ((p.floor ?? 1) !== myFloor) return; // só quem está no meu andar
        const cx = (p.x - region.x) * scale;
        const cy = (p.y - region.y) * scale;
        const me = sid === meSessionId;
        const uid = p.userId || "";
        const photo: string = p.photo || "";
        dots.push({ cx, cy, x: p.x, y: p.y, me, name: p.name || "?", userId: uid, photo });
        let img: HTMLImageElement | undefined;
        if (photo) {
          img = photoCache.current.get(photo);
          if (!img) {
            img = new Image();
            img.src = photo;
            photoCache.current.set(photo, img);
          }
        }
        if (img && img.complete && img.naturalWidth > 0) {
          // Foto de perfil (recortada em círculo) no lugar do ponto.
          const r = me ? 7 : 6;
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
          ctx.restore();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = me ? "#4ade80" : "#0b1220";
          ctx.lineWidth = me ? 2 : 1;
          ctx.stroke();
        } else {
          // Sem foto (ou ainda carregando) → ponto colorido como antes.
          ctx.beginPath();
          ctx.arc(cx, cy, me ? 5 : 4, 0, Math.PI * 2);
          ctx.fillStyle = me ? "#4ade80" : "#38bdf8";
          ctx.fill();
          ctx.strokeStyle = "#0b1220";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
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

      // Tooltip no hover: foto (se houver) + nome.
      const hov = hoverRef.current;
      if (hov) {
        ctx.font = "11px system-ui, -apple-system";
        const tw = ctx.measureText(hov.name).width;
        const himg = hov.photo ? photoCache.current.get(hov.photo) : undefined;
        const hasPhoto = !!(himg && himg.complete && himg.naturalWidth > 0);
        const PS = 40;          // tamanho da foto no tooltip
        const PAD = 6;
        const bw = (hasPhoto ? PS + PAD : 0) + tw + PAD * 2;
        const bh = hasPhoto ? PS + PAD * 2 : 16;
        let bx = hov.cx + 10;
        let by = hov.cy - bh / 2;
        if (bx + bw > cv.width) bx = hov.cx - bw - 10;
        if (bx < 2) bx = 2;
        if (by < 2) by = 2;
        if (by + bh > cv.height) by = cv.height - bh - 2;
        ctx.fillStyle = "#000000d8";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, bh);
        let tx = bx + PAD;
        if (hasPhoto) {
          const px2 = bx + PAD;
          const py2 = by + PAD;
          ctx.save();
          ctx.beginPath();
          ctx.arc(px2 + PS / 2, py2 + PS / 2, PS / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(himg as HTMLImageElement, px2, py2, PS, PS);
          ctx.restore();
          tx = px2 + PS + PAD;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillText(hov.name, tx, by + bh / 2 + 4);
      }
    };
    draw();
    const id = window.setInterval(draw, 250);
    return () => window.clearInterval(id);
  }, [room, meSessionId, scale, myFloor]);

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
    let best: { cx: number; cy: number; name: string; photo: string; d2: number } | null = null;
    for (const d of dotsRef.current) {
      const dd = (d.cx - px) ** 2 + (d.cy - py) ** 2;
      if (dd < 16 * 16 && (!best || dd < best.d2)) {
        best = { cx: d.cx, cy: d.cy, name: d.me ? `${d.name} (você)` : d.name, photo: d.photo, d2: dd };
      }
    }
    hoverRef.current = best ? { cx: best.cx, cy: best.cy, name: best.name, photo: best.photo } : null;
  }

  return (
    <div style={{ ...panelStyle, ...drag.style }}>
      <div
        style={{ ...headerStyle, cursor: "move" }}
        onPointerDown={drag.onHandlePointerDown}
      >
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
