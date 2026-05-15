import Phaser from "phaser";

/**
 * Centraliza o carregamento de assets do pacote LimeZu Modern Interiors Free.
 * Arquivos em client/public/assets/ — servidos pelo Vite como /assets/*.
 *
 * Conventions:
 *  - Spritesheet de personagem: 16x32 (largura x altura) por frame
 *  - Tileset de mobília:        32x32 por tile
 *  - Tileset Room Builder:      32x32 por tile
 *
 * Etapa 1: só preload. As keys serão usadas nas etapas seguintes.
 */

export const CHARACTER_KEYS = ["adam", "alex", "amelia", "bob"] as const;
export type CharacterId = typeof CHARACTER_KEYS[number];

/** Spritesheets de personagem — usadas em createMyAvatar / createRemoteAvatar (etapa 3). */
const CHARACTER_FILES: Record<CharacterId, string> = {
  adam: "Adam_16x16.png",
  alex: "Alex_16x16.png",
  amelia: "Amelia_16x16.png",
  bob: "Bob_16x16.png",
};

/** Largura/altura de cada frame nos spritesheets de personagem.
 *  Adam_16x16.png tem o sprite renderizado em "tiles" de 16x32 (corpo + cabeça).
 *  Ajuste se descobrirmos que o frame real é diferente ao testar. */
export const CHARACTER_FRAME_W = 16;
export const CHARACTER_FRAME_H = 32;

export function preloadLimezuAssets(scene: Phaser.Scene) {
  // === Personagens ===
  for (const id of CHARACTER_KEYS) {
    scene.load.spritesheet(`char_${id}`, `/assets/characters/${CHARACTER_FILES[id]}`, {
      frameWidth: CHARACTER_FRAME_W,
      frameHeight: CHARACTER_FRAME_H,
    });
  }

  // === Tilesets de mobília e cenário ===
  // Carrega como imagem; recortamos tiles em runtime via TextureManager.add
  // ou ao criar TileMap (etapas 2 e 4).
  scene.load.image("tileset_interiors", "/assets/interiors/Interiors_32x32.png");
  scene.load.image("tileset_roombuilder", "/assets/interiors/RoomBuilder_32x32.png");
}

/** Tamanho default de tile do pacote (escolhi a versão 32x32). */
export const TILE_SIZE = 32;
