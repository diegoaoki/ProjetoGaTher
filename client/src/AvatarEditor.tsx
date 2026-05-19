import { useEffect, useRef, useState } from "react";
import { parseAppearance, DEFAULT_APPEARANCE, AvatarSlot } from "./AvatarParts";

/**
 * Editor de avatar modular. Abas por slot (Corpo/Roupa/Cabelo/Acessório);
 * cada aba mostra uma GRADE de miniaturas (galeria) — clica pra escolher,
 * com preview ao vivo. Usa `_thumbs.png` (grade 16 col × 16×32) +
 * `manifest.json` por slot — NÃO carrega as 850 texturas. Salva via
 * onSave(JSON) na ordem body→outfit→hair→hat.
 */

const SLOTS: AvatarSlot[] = ["body", "outfit", "hair", "hat"];
const SLOT_LABEL: Record<AvatarSlot, string> = {
  body: "Corpo",
  outfit: "Roupa",
  hair: "Cabelo",
  hat: "Acessório",
};
const THUMB_COLS = 16;
const TW = 16;
const TH = 32;

interface Props {
  currentAppearance: string | null;
  saving: boolean;
  error: string;
  onSave: (appearanceJson: string) => void;
  onClose: () => void;
}

/** Desenha uma célula (16×32) do thumb sheet num canvas ampliado. */
function ThumbCanvas({
  img, idx, w, h,
}: { img: HTMLImageElement | undefined; idx: number; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!img) return;
    const sx = (idx % THUMB_COLS) * TW;
    const sy = Math.floor(idx / THUMB_COLS) * TH;
    ctx.drawImage(img, sx, sy, TW, TH, 0, 0, w, h);
  }, [img, idx, w, h]);
  return <canvas ref={ref} width={w} height={h} style={{ imageRendering: "pixelated", display: "block" }} />;
}

export default function AvatarEditor({ currentAppearance, saving, error, onSave, onClose }: Props) {
  const [manifests, setManifests] = useState<Record<AvatarSlot, string[]> | null>(null);
  const [thumbs, setThumbs] = useState<Record<AvatarSlot, HTMLImageElement> | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [tab, setTab] = useState<AvatarSlot>("body");

  const init = parseAppearance(currentAppearance) || DEFAULT_APPEARANCE;
  const [sel, setSel] = useState<Record<AvatarSlot, string>>({
    body: init.body || DEFAULT_APPEARANCE.body,
    outfit: init.outfit || "",
    hair: init.hair || "",
    hat: init.hat || "",
  });
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ms = {} as Record<AvatarSlot, string[]>;
        const ts = {} as Record<AvatarSlot, HTMLImageElement>;
        await Promise.all(
          SLOTS.map(async (s) => {
            const r = await fetch(`/assets/characters/parts/${s}/manifest.json`);
            ms[s] = r.ok ? await r.json() : [];
            await new Promise<void>((res) => {
              const img = new Image();
              img.onload = () => { ts[s] = img; res(); };
              img.onerror = () => res();
              img.src = `/assets/characters/parts/${s}/_thumbs.png`;
            });
          })
        );
        if (!alive) return;
        if (SLOTS.every((s) => (ms[s]?.length ?? 0) === 0)) {
          setLoadErr("Peças do avatar não encontradas (deploy pendente?).");
          return;
        }
        setManifests(ms);
        setThumbs(ts);
      } catch {
        if (alive) setLoadErr("Falha ao carregar peças do avatar.");
      }
    })();
    return () => { alive = false; };
  }, []);

  // Preview ao vivo: empilha body→outfit→hair→hat (frame idle-frente).
  useEffect(() => {
    const c = previewRef.current;
    if (!c || !manifests || !thumbs) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const slot of SLOTS) {
      const key = sel[slot];
      if (!key) continue;
      const idx = manifests[slot].indexOf(key);
      if (idx < 0 || !thumbs[slot]) continue;
      const sx = (idx % THUMB_COLS) * TW;
      const sy = Math.floor(idx / THUMB_COLS) * TH;
      ctx.drawImage(thumbs[slot], sx, sy, TW, TH, 0, 0, c.width, c.height);
    }
  }, [sel, manifests, thumbs]);

  function pick(slot: AvatarSlot, key: string) {
    setSel((s) => ({ ...s, [slot]: key }));
  }

  function handleSave() {
    onSave(JSON.stringify({
      body: sel.body || DEFAULT_APPEARANCE.body,
      outfit: sel.outfit || "none",
      hair: sel.hair || "none",
      hat: sel.hat || "none",
    }));
  }

  const ready = !!manifests && !!thumbs;
  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, background: active ? "#2563eb" : "#1e293b",
    border: active ? "1px solid #60a5fa" : "1px solid #334155",
    color: "#e2e8f0", borderRadius: 6, padding: "6px 4px", cursor: "pointer",
    fontSize: 12,
  });

  // Itens da aba ativa: slots opcionais ganham um tile "Nenhum" no início.
  const items: string[] =
    ready
      ? (tab === "body" ? manifests!.body : ["", ...manifests![tab]])
      : [];

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Editar avatar</h2>
      <p style={{ margin: "0 0 10px", fontSize: 12, opacity: 0.7 }}>
        Escolha as peças. Salva pra todos verem.
      </p>

      {!ready && !loadErr && <p style={{ fontSize: 13, opacity: 0.7 }}>Carregando peças…</p>}
      {loadErr && <p style={{ color: "#f87171", fontSize: 13 }}>{loadErr}</p>}

      {ready && (
        <>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0 }}>
              <canvas
                ref={previewRef}
                width={96}
                height={192}
                style={{
                  imageRendering: "pixelated", background: "#0b1220",
                  border: "1px solid #334155", borderRadius: 8, display: "block",
                }}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                {SLOTS.map((s) => (
                  <button key={s} style={tabBtn(tab === s)} onClick={() => setTab(s)}>
                    {SLOT_LABEL[s]}
                  </button>
                ))}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))",
                  gap: 6,
                  maxHeight: 240,
                  overflowY: "auto",
                  padding: 4,
                  background: "#0b1220",
                  border: "1px solid #334155",
                  borderRadius: 8,
                }}
              >
                {items.map((key) => {
                  const selected = sel[tab] === key;
                  const idx = key ? manifests![tab].indexOf(key) : -1;
                  return (
                    <button
                      key={key || "__none__"}
                      onClick={() => pick(tab, key)}
                      title={key ? key : "Nenhum"}
                      style={{
                        background: selected ? "#1d4ed8" : "#1e293b",
                        border: selected ? "2px solid #60a5fa" : "1px solid #334155",
                        borderRadius: 6, padding: 2, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        minHeight: 56,
                      }}
                    >
                      {key ? (
                        <ThumbCanvas img={thumbs![tab]} idx={idx} w={26} h={52} />
                      ) : (
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>Nenhum</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {error && <p style={{ color: "#f87171", marginTop: 10, fontSize: 13 }}>{error}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              onClick={handleSave}
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
        </>
      )}
    </div>
  );
}
