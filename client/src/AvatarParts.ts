/**
 * Avatar modular (LimeZu Character Generator).
 *
 * O avatar é composto por camadas empilhadas (body → outfit → hair → hat),
 * cada uma um spritesheet 384×32 (24 frames = 6/dir, ordem right/up/left/down,
 * frame 16×32) extraído pelo pipeline (client/scripts/avatar_pipeline.ps1)
 * pra `public/assets/characters/parts/<slot>/<key>_{idle,run}.png`.
 *
 * 850 sheets no total → NÃO dá pra pré-carregar. Este módulo carrega
 * SOB DEMANDA só as peças de um `appearance` e cria as anims
 * `<key>_<dir>_{idle,walk}` (mesmo naming/grade do AssetLoader legado).
 *
 * Este módulo é PURO (não toca no OfficeScene): parsing + loader + anims.
 * A composição visual (Container de sprites) é feita por quem consome.
 */
import Phaser from "phaser";
import {
  DIRECTION_ORDER,
  FRAMES_PER_DIRECTION,
  CHARACTER_FRAME_W,
  CHARACTER_FRAME_H,
} from "./AssetLoader";

export type AvatarSlot = "body" | "outfit" | "hair" | "hat";

/** Ordem de empilhamento (depth dentro do container). Doc do LimeZu:
 *  body → eyes → outfit → hair → accessory. (eyes embutido no body.) */
export const LAYER_ORDER: AvatarSlot[] = ["body", "outfit", "hair", "hat"];

export interface Appearance {
  body: string;   // ex: "body_01"
  outfit: string;  // ex: "outfit_01_01" ou "" (sem camada)
  hair: string;    // ex: "hair_01_01" ou ""
  hat: string;     // ex: "hat_03_backpack_01" ou ""
}

/** Default pra quem não tem appearance custom (1º corpo, roupa básica). */
export const DEFAULT_APPEARANCE: Appearance = {
  body: "body_01",
  outfit: "outfit_01_01",
  hair: "hair_01_01",
  hat: "",
};

/**
 * Faz parse do JSON do schema. Retorna `null` se vazio/inválido — o
 * chamador então usa o avatar legado (4 personagens). Faz merge com o
 * default (slot ausente herda o default; "" ou "none" = sem camada).
 */
export function parseAppearance(json: string | null | undefined): Appearance | null {
  if (!json) return null;
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const pick = (k: AvatarSlot): string => {
    const v = raw[k];
    if (typeof v !== "string") return DEFAULT_APPEARANCE[k];
    if (v === "none") return "";
    return v;
  };
  return {
    body: pick("body") || DEFAULT_APPEARANCE.body, // body nunca vazio
    outfit: pick("outfit"),
    hair: pick("hair"),
    hat: pick("hat"),
  };
}

/** slot a partir do prefixo da key (body_01 → body, hair_x → hair...). */
function slotOf(partKey: string): AvatarSlot | null {
  const p = partKey.split("_")[0];
  if (p === "body" || p === "outfit" || p === "hair" || p === "hat") return p;
  return null;
}

/** Keys de peça não-vazias do appearance, na ordem de empilhamento. */
export function layerKeys(app: Appearance): string[] {
  return LAYER_ORDER.map((s) => app[s]).filter((k) => !!k);
}

/** Cria as anims `<key>_<dir>_{idle,walk}` pra uma peça (idempotente). */
function createPartAnims(scene: Phaser.Scene, partKey: string) {
  const idleSheet = `${partKey}_idle`;
  const runSheet = `${partKey}_run`;
  if (!scene.textures.exists(idleSheet) || !scene.textures.exists(runSheet)) return;
  DIRECTION_ORDER.forEach((dir, dirIdx) => {
    const start = dirIdx * FRAMES_PER_DIRECTION;
    const end = start + FRAMES_PER_DIRECTION - 1;
    const idleKey = `${partKey}_${dir}_idle`;
    if (!scene.anims.exists(idleKey)) {
      scene.anims.create({
        key: idleKey,
        frames: scene.anims.generateFrameNumbers(idleSheet, { start, end }),
        frameRate: 6,
        repeat: -1,
      });
    }
    const walkKey = `${partKey}_${dir}_walk`;
    if (!scene.anims.exists(walkKey)) {
      scene.anims.create({
        key: walkKey,
        frames: scene.anims.generateFrameNumbers(runSheet, { start, end }),
        frameRate: 10,
        repeat: -1,
      });
    }
  });
}

/**
 * Garante que TODAS as peças de `app` estão carregadas (lazy) e com anims
 * criadas; chama `onReady` quando pronto (ou já-pronto, síncrono).
 * Robusto a erro de arquivo (peça que falhar é só pulada no render).
 */
export function ensureAvatarParts(
  scene: Phaser.Scene,
  app: Appearance,
  onReady: () => void
) {
  const keys = layerKeys(app);
  const toLoad: string[] = [];
  for (const key of keys) {
    const slot = slotOf(key);
    if (!slot) continue;
    for (const variant of ["idle", "run"] as const) {
      const texKey = `${key}_${variant}`;
      // Phaser deduplica keys já no cache; key repetida na fila é ignorada.
      if (!scene.textures.exists(texKey)) {
        scene.load.spritesheet(
          texKey,
          `/assets/characters/parts/${slot}/${key}_${variant}.png`,
          { frameWidth: CHARACTER_FRAME_W, frameHeight: CHARACTER_FRAME_H }
        );
        toLoad.push(texKey);
      }
    }
  }

  const finish = () => {
    for (const key of keys) createPartAnims(scene, key);
    onReady();
  };

  if (toLoad.length === 0) {
    finish();
    return;
  }
  // load.once('complete') só dispara se start() for chamado. Se já há um
  // load em andamento, enfileira e o complete cobre todos.
  scene.load.once(Phaser.Loader.Events.COMPLETE, finish);
  scene.load.start();
}

/** Manifest de um slot (lista de keys) — usado pela UI do editor. */
export async function loadSlotManifest(slot: AvatarSlot): Promise<string[]> {
  try {
    const r = await fetch(`/assets/characters/parts/${slot}/manifest.json`);
    if (!r.ok) return [];
    const arr = await r.json();
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
