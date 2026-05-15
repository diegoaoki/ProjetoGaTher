import { useEffect, useRef, useState } from "react";

/**
 * Inspector visual do tileset LimeZu Interiors_32x32.png.
 * Renderiza a imagem em escala 2x com grid sobreposto mostrando (col, row) e
 * o frame index de cada tile. Útil pra encontrar coordenadas corretas pra
 * popular FurnitureTiles.ts.
 *
 * Acessa via ?inspect=tiles na URL.
 */

const TILE = 32;
const SCALE = 2;
const ASSETS = [
  { key: "Interiors", path: "/assets/interiors/Interiors_32x32.png" },
  { key: "RoomBuilder", path: "/assets/interiors/RoomBuilder_32x32.png" },
];

export default function TileInspector() {
  const [active, setActive] = useState(ASSETS[0]);
  const [hovered, setHovered] = useState<{ col: number; row: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      drawAll();
    };
    img.src = active.path;
  }, [active]);

  function drawAll() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    canvas.width = img.width * SCALE;
    canvas.height = img.height * SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Grid + numbers
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    const cols = Math.floor(img.width / TILE);
    const rows = Math.floor(img.height / TILE);
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * TILE * SCALE, 0);
      ctx.lineTo(c * TILE * SCALE, canvas.height);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * TILE * SCALE);
      ctx.lineTo(canvas.width, r * TILE * SCALE);
      ctx.stroke();
    }
    // Coordenadas no canto superior esquerdo de cada tile
    ctx.font = "bold 9px monospace";
    ctx.textBaseline = "top";
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * TILE * SCALE + 2;
        const y = r * TILE * SCALE + 2;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(x - 1, y - 1, 26, 10);
        ctx.fillStyle = "#facc15";
        ctx.fillText(`${c},${r}`, x, y);
      }
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const col = Math.floor(x / (TILE * SCALE));
    const row = Math.floor(y / (TILE * SCALE));
    setHovered({ col, row });
  }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", color: "#e2e8f0", padding: 16 }}>
      <div style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <strong>Tileset Inspector</strong>
        {ASSETS.map((a) => (
          <button
            key={a.key}
            onClick={() => setActive(a)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: active.key === a.key ? "#4ade80" : "#334155",
              color: active.key === a.key ? "#052e16" : "#e2e8f0",
              fontWeight: 600,
            }}
          >
            {a.key}
          </button>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 13, opacity: 0.8 }}>
          Hover pra ver coordenada. Cada tile = {TILE}×{TILE}px (renderizado em {SCALE}× pra ler).
        </div>
        {hovered && (
          <div style={{
            background: "#1e293b",
            padding: "4px 10px",
            borderRadius: 6,
            fontFamily: "monospace",
            fontSize: 13,
            border: "1px solid #4ade80",
          }}>
            col: <strong>{hovered.col}</strong> / row: <strong>{hovered.row}</strong>
          </div>
        )}
      </div>
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 80px)", border: "1px solid #334155" }}>
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          style={{ display: "block", imageRendering: "pixelated", cursor: "crosshair" }}
        />
      </div>
    </div>
  );
}
