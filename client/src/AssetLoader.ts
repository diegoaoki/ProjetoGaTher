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

/** Direções na ordem dos frames do spritesheet (assumido). */
export const DIRECTION_ORDER = ["down", "left", "right", "up"] as const;
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
 *  Mesma userId sempre vira o mesmo personagem — todos veem todos igual. */
export function pickCharacterFor(userId: string): CharacterId {
  if (!userId) return "adam";
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % CHARACTER_KEYS.length;
  return CHARACTER_KEYS[idx];
}
