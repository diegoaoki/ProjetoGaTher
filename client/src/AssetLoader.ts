import Phaser from "phaser";

/**
 * Carrega e configura os assets do pacote LimeZu Modern Interiors Free.
 *
 * Personagens:
 *   - 4 personagens base (Adam, Alex, Amelia, Bob)
 *   - Cada um tem 3 spritesheets: idle_anim, run, sit
 *   - Frame: 16x32 (corpo+cabeça vertical)
 *   - 24 frames por sheet = 4 direções × 6 frames
 *   - Ordem assumida (convenção comum LPC-like): down(0-5) / left(6-11) / right(12-17) / up(18-23)
 *
 * Tilesets (Interiors + RoomBuilder) já carregam como image —
 * uso será nas etapas posteriores.
 */

export const CHARACTER_KEYS = ["adam", "alex", "amelia", "bob"] as const;
export type CharacterId = typeof CHARACTER_KEYS[number];

const CHARACTER_NAMES: Record<CharacterId, string> = {
  adam: "Adam",
  alex: "Alex",
  amelia: "Amelia",
  bob: "Bob",
};

export const CHARACTER_FRAME_W = 16;
export const CHARACTER_FRAME_H = 32;
export const FRAMES_PER_DIRECTION = 6;

/** Direções na ordem dos frames do spritesheet (descoberto via teste).
 *  frames 0-5  = right
 *  frames 6-11 = up
 *  frames 12-17 = left
 *  frames 18-23 = down
 */
export const DIRECTION_ORDER = ["right", "up", "left", "down"] as const;
export type Direction = typeof DIRECTION_ORDER[number];

export const TILE_SIZE = 32;

export function preloadLimezuAssets(scene: Phaser.Scene) {
  for (const id of CHARACTER_KEYS) {
    const name = CHARACTER_NAMES[id];
    scene.load.spritesheet(
      `${id}_idle`,
      `/assets/characters/${name}_idle_anim_16x16.png`,
      { frameWidth: CHARACTER_FRAME_W, frameHeight: CHARACTER_FRAME_H }
    );
    scene.load.spritesheet(
      `${id}_run`,
      `/assets/characters/${name}_run_16x16.png`,
      { frameWidth: CHARACTER_FRAME_W, frameHeight: CHARACTER_FRAME_H }
    );
    scene.load.spritesheet(
      `${id}_sit`,
      `/assets/characters/${name}_sit_16x16.png`,
      { frameWidth: CHARACTER_FRAME_W, frameHeight: CHARACTER_FRAME_H }
    );
  }

  scene.load.image("tileset_interiors", "/assets/interiors/Interiors_32x32.png");
  scene.load.image("tileset_roombuilder", "/assets/interiors/RoomBuilder_32x32.png");
  // Sala pronta usada como source pra extrair piso de madeira (parquet)
  scene.load.image("home_layer1", "/assets/interiors/GenericHome_Layer1.png");

  // Mobília de cozinha (Copa) — sprites Singles do LimeZu Modern Interiors
  // (pago). Cada PNG vira uma texture com a key = type do FurnitureItem,
  // então OfficeScene.drawFurniture() (this.add.image(x,y,type)) usa
  // direto. Tamanhos nativos: fridge 32×80, stove/counter_sink 32×64,
  // counter 64×64, coffee_machine 32×48, microwave/range_hood/
  // kitchen_table 32×32.
  for (const k of KITCHEN_SPRITES) {
    scene.load.image(k, `/assets/interiors/kitchen/${k}.png`);
  }

  // Sala de Segurança — sprites LimeZu (tema TV/Film Studio): parede de
  // monitores CCTV, console de controle, rack e câmera. Mesmo esquema
  // (key == type). cctv_screen* 64×64, security_console 32×48,
  // server_rack 32×32, security_camera 32×64.
  for (const k of SECURITY_SPRITES) {
    scene.load.image(k, `/assets/interiors/security/${k}.png`);
  }

  // Mesas (reunião / Copa / centro) — compostas de peças LimeZu
  // Conference Hall (ponta+meio+ponta espelhada), proporção larga
  // agradável. key == type → substitui as procedurais/tileset.
  for (const k of TABLES_SPRITES) {
    scene.load.image(k, `/assets/interiors/tables/${k}.png`);
  }

  // Workstations por departamento (mesa de madeira + 2 monitores na
  // cor do setor). `type` segue "desk" (reserva intacta); só a textura
  // muda via FurnitureItem.tex. desk_dev/dados/infra/fin 64×64.
  for (const k of DESK_SPRITES) {
    scene.load.image(k, `/assets/interiors/desks/${k}.png`);
  }
}

/** Móveis de cozinha carregados como texturas próprias (key == type). */
export const KITCHEN_SPRITES = [
  "fridge",
  "stove",
  "microwave",
  "coffee_machine",
  "counter",
  "counter_sink",
  "range_hood",
] as const;

/** Mesas compostas (LimeZu Conference Hall). key == type. */
export const TABLES_SPRITES = [
  "meetingTable",
  "kitchen_table",
  "coffeeTable",
] as const;

/** Desks por departamento (texturas via FurnitureItem.tex). */
export const DESK_SPRITES = [
  "desk_dev",
  "desk_dados",
  "desk_infra",
  "desk_fin",
] as const;

/** Móveis da sala de Segurança (key == type). */
export const SECURITY_SPRITES = [
  "cctv_screen",
  "cctv_screen2",
  "cctv_screen3",
  "security_console",
  "server_rack",
  "security_camera",
] as const;

/**
 * Extrai uma região do `home_layer1` (sala pronta com piso de madeira parquet)
 * pra criar uma texture tileable 'floorWoodLime'. Substitui o canvas
 * procedural antigo (createFloorTextures.floorWood do SpriteFactory).
 *
 * Coordenadas (192, 120, 64, 64) escolhidas pra cair dentro da área de parquet
 * limpo no centro da Generic_Home_1. Se aparecer costura visível, ajustar.
 */
export function registerLimezuFloor(scene: Phaser.Scene) {
  if (scene.textures.exists("floorWoodLime")) return;
  if (!scene.textures.exists("home_layer1")) return;
  const src = scene.textures.get("home_layer1").getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const SX = 192, SY = 120, SIZE = 64;
  const canvasTex = scene.textures.createCanvas("floorWoodLime", SIZE, SIZE);
  if (!canvasTex) return;
  canvasTex.context.drawImage(src, SX, SY, SIZE, SIZE, 0, 0, SIZE, SIZE);
  canvasTex.refresh();
}

/**
 * Cria animations pra TODOS os 4 personagens × 4 direções × {idle, walk}.
 * Naming: `${charId}_${direction}_${anim}` (ex: "adam_down_walk")
 * Chamar uma vez na scene depois do load.
 */
export function createCharacterAnimations(scene: Phaser.Scene) {
  for (const id of CHARACTER_KEYS) {
    DIRECTION_ORDER.forEach((dir, dirIdx) => {
      const start = dirIdx * FRAMES_PER_DIRECTION;
      const end = start + FRAMES_PER_DIRECTION - 1;

      // Idle (animação suave de respiração)
      const idleKey = `${id}_${dir}_idle`;
      if (!scene.anims.exists(idleKey)) {
        scene.anims.create({
          key: idleKey,
          frames: scene.anims.generateFrameNumbers(`${id}_idle`, { start, end }),
          frameRate: 6,
          repeat: -1,
        });
      }

      // Walk
      const walkKey = `${id}_${dir}_walk`;
      if (!scene.anims.exists(walkKey)) {
        scene.anims.create({
          key: walkKey,
          frames: scene.anims.generateFrameNumbers(`${id}_run`, { start, end }),
          frameRate: 10,
          repeat: -1,
        });
      }
    });
  }
}

/** Hash determinístico que escolhe um personagem baseado no userId.
 *  Usado como FALLBACK quando o user não escolheu manualmente. */
function hashCharacter(userId: string): CharacterId {
  if (!userId) return "adam";
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % CHARACTER_KEYS.length;
  return CHARACTER_KEYS[idx];
}

/** Resolve o personagem: prefere a escolha explícita (profile.character_id);
 *  fallback determinístico via hash do userId se não escolheu. */
export function pickCharacterFor(userId: string, override?: string | null): CharacterId {
  if (override && (CHARACTER_KEYS as readonly string[]).includes(override)) {
    return override as CharacterId;
  }
  return hashCharacter(userId);
}
