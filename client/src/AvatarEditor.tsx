import { useEffect, useMemo, useRef, useState } from "react";
import { parseAppearance, DEFAULT_APPEARANCE, AvatarSlot } from "./AvatarParts";

/**
 * Editor de avatar modular. Usa os `_thumbs.png` (grade 16 col × 16×32)
 * + `manifest.json` por slot — NÃO carrega as 850 texturas. Preview ao
 * vivo compõe as células de thumb (frame idle-frente) na ordem
 * body→outfit→hair→hat. Salva via onSave(JSON).
 */

const SLOTS: AvatarSlot[] = ["body", "outfit", "hair", "hat"];
const SLOT_LABEL: Record<AvatarSlot, string> = {
  body: "Corpo (pele)",
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

export default function AvatarEditor({ currentAppearance, saving, error, onSave, onClose }: Props) {
  const [manifests, setManifests] = useState<Record<AvatarSlot, string[]> | null>(null);
  const [thumbs, setThumbs] = useState<Record<AvatarSlot, HTMLImageElement> | null>(null);
  const [loadErr, setLoadErr] = useState("");
  // seleção por slot: key da peça, ou "" = nenhum (não vale pra body)
  const init = parseAppearance(currentAppearance) || DEFAULT_APPEARANCE;
  const [sel, setSel] = useState<Record<AvatarSlot, string>>({
    body: init.body || DEFAULT_APPEARANCE.body,
    outfit: init.outfit || "",
    hair: init.hair || "",
    hat: init.hat || "",
  });
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Carrega os 4 manifests + 4 thumb sheets uma vez.
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
        setManifests(ms);
        setThumbs(ts);
      } catch {
        if (alive) setLoadErr("Falha ao carregar peças do avatar.");
      }
    })();
    return () => { alive = false; };
  }, []);

  // Cabelo: agrupa key `hair_<estilo>_<cor>` em estilo + cor.
  const hairGroups = useMemo(() => {
    const keys = manifests?.hair || [];
    const styles: string[] = [];
    const byStyle = new Map<string, string[]>(); // estilo -> [keys]
    for (const k of keys) {
      const p = k.split("_"); // ["hair", estilo, cor]
      const st = p[1] || "";
      if (!byStyle.has(st)) { byStyle.set(st, []); styles.push(st); }
      byStyle.get(st)!.push(k);
    }
    return { styles, byStyle };
  }, [manifests]);

  function thumbCell(slot: AvatarSlot, key: string) {
    if (!manifests || !thumbs) return null;
    const idx = manifests[slot].indexOf(key);
    if (idx < 0 || !thumbs[slot]) return null;
    return {
      img: thumbs[slot],
      sx: (idx % THUMB_COLS) * TW,
      sy: Math.floor(idx / THUMB_COLS) * TH,
    };
  }

  // Compõe o preview (idle-frente) empilhando body→outfit→hair→hat.
  useEffect(() => {
    const c = previewRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const slot of SLOTS) {
      const key = sel[slot];
      if (!key) continue;
      const cell = thumbCell(slot, key);
      if (!cell) continue;
      ctx.drawImage(cell.img, cell.sx, cell.sy, TW, TH, 0, 0, c.width, c.height);
    }
  }, [sel, manifests, thumbs]);

  // ◀ ▶ genérico sobre uma lista; permitNone insere "" no ciclo.
  function cycle(slot: AvatarSlot, list: string[], dir: 1 | -1, permitNone: boolean) {
    const opts = permitNone ? ["", ...list] : list;
    if (opts.length === 0) return;
    const cur = opts.indexOf(sel[slot]);
    const i = (((cur < 0 ? 0 : cur) + dir) % opts.length + opts.length) % opts.length;
    setSel((s) => ({ ...s, [slot]: opts[i] }));
  }

  // Cabelo: cicla estilo (mantendo cor se existir) ou cor dentro do estilo.
  function cycleHairStyle(dir: 1 | -1) {
    const styles = ["", ...hairGroups.styles]; // "" = sem cabelo
    const curKey = sel.hair;
    const curStyle = curKey ? curKey.split("_")[1] : "";
    const ci = styles.indexOf(curStyle);
    const ni = (((ci < 0 ? 0 : ci) + dir) % styles.length + styles.length) % styles.length;
    const st = styles[ni];
    if (!st) { setSel((s) => ({ ...s, hair: "" })); return; }
    const variants = hairGroups.byStyle.get(st) || [];
    const curColor = curKey ? curKey.split("_")[2] : "";
    const same = variants.find((k) => k.split("_")[2] === curColor);
    setSel((s) => ({ ...s, hair: same || variants[0] || "" }));
  }
  function cycleHairColor(dir: 1 | -1) {
    const curKey = sel.hair;
    if (!curKey) return;
    const st = curKey.split("_")[1];
    const variants = hairGroups.byStyle.get(st) || [];
    if (variants.length === 0) return;
    const ci = variants.indexOf(curKey);
    const ni = (((ci < 0 ? 0 : ci) + dir) % variants.length + variants.length) % variants.length;
    setSel((s) => ({ ...s, hair: variants[ni] }));
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
  const btn: React.CSSProperties = {
    background: "#334155", border: "1px solid #475569", color: "#e2e8f0",
    borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 14, minWidth: 34,
  };
  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 8, padding: "6px 0",
  };

  function Row({ slot, children }: { slot: AvatarSlot; children: React.ReactNode }) {
    return (
      <div style={rowStyle}>
        <span style={{ fontSize: 13, opacity: 0.85, minWidth: 92 }}>{SLOT_LABEL[slot]}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{children}</div>
      </div>
    );
  }

  const hairLabel = sel.hair
    ? `estilo ${sel.hair.split("_")[1]} · cor ${sel.hair.split("_")[2]}`
    : "Nenhum";

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Editar avatar</h2>
      <p style={{ margin: "0 0 12px", fontSize: 12, opacity: 0.7 }}>
        Monte seu personagem por partes. Salva pra todos verem.
      </p>

      {!ready && !loadErr && <p style={{ fontSize: 13, opacity: 0.7 }}>Carregando peças…</p>}
      {loadErr && <p style={{ color: "#f87171", fontSize: 13 }}>{loadErr}</p>}

      {ready && (
        <>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <canvas
              ref={previewRef}
              width={96}
              height={192}
              style={{
                imageRendering: "pixelated",
                background: "#0b1220",
                border: "1px solid #334155",
                borderRadius: 8,
              }}
            />
          </div>

          <Row slot="body">
            <button style={btn} onClick={() => cycle("body", manifests!.body, -1, false)}>◀</button>
            <span style={{ fontSize: 12, minWidth: 70, textAlign: "center" }}>
              {sel.body.replace("body_", "#")}
            </span>
            <button style={btn} onClick={() => cycle("body", manifests!.body, 1, false)}>▶</button>
          </Row>

          <Row slot="outfit">
            <button style={btn} onClick={() => cycle("outfit", manifests!.outfit, -1, true)}>◀</button>
            <span style={{ fontSize: 12, minWidth: 70, textAlign: "center" }}>
              {sel.outfit ? sel.outfit.replace("outfit_", "#") : "Nenhum"}
            </span>
            <button style={btn} onClick={() => cycle("outfit", manifests!.outfit, 1, true)}>▶</button>
          </Row>

          <Row slot="hair">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button style={btn} onClick={() => cycleHairStyle(-1)}>◀</button>
                <span style={{ fontSize: 12, minWidth: 110, textAlign: "center" }}>{hairLabel}</span>
                <button style={btn} onClick={() => cycleHairStyle(1)}>▶</button>
              </div>
              {sel.hair && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                  <button style={btn} onClick={() => cycleHairColor(-1)}>◀ cor</button>
                  <button style={btn} onClick={() => cycleHairColor(1)}>cor ▶</button>
                </div>
              )}
            </div>
          </Row>

          <Row slot="hat">
            <button style={btn} onClick={() => cycle("hat", manifests!.hat, -1, true)}>◀</button>
            <span style={{ fontSize: 12, minWidth: 70, textAlign: "center" }}>
              {sel.hat ? sel.hat.replace("hat_", "").replace(/_/g, " ") : "Nenhum"}
            </span>
            <button style={btn} onClick={() => cycle("hat", manifests!.hat, 1, true)}>▶</button>
          </Row>

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
