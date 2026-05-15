import Phaser from "phaser";
import { TILE_SIZE } from "./AssetLoader";

/**
 * Mapeamento de TIPO DE MÓVEL → coordenada no tileset LimeZu Interiors_32x32.png
 *
 * Cada entry é { col, row } baseado em tiles de 32×32. O tileset tem
 * 16 colunas × 89 linhas (1424 tiles). Coordenadas começam em 0.
 *
 * Estes números são CHUTES baseados em inspeção visual do tileset.
 * Quando o jogo rodar, se algum móvel aparecer errado, ajuste o (col, row).
 *
 * Pra testar visualmente o tileset, acesse o jogo com ?tiles=1 (TODO).
 */
export const FURNITURE_TILES: Record<string, { col: number; row: number; w?: number; h?: number }> = {
  // Mesa de escritório (3 tiles de largura no tileset original, mas vamos usar 1)
  desk:        { col: 0, row: 12 },
  // Cadeira de escritório
  chair:       { col: 0, row: 10 },
  // Sofá
  sofa:        { col: 0, row: 36, w: 3, h: 2 },
  // Mesa de centro
  coffeeTable: { col: 8, row: 25 },
  // Planta vaso
  plant:       { col: 11, row: 25 },
  // Lousa branca
  whiteboard:  { col: 5, row: 4 },
  // Estante
  bookshelf:   { col: 0, row: 20, w: 1, h: 2 },
  // Monitor (vai em cima da mesa)
  monitor:     { col: 12, row: 5 },
  // TV (mantida pra futuras salas)
  tv:          { col: 0, row: 5, w: 2, h: 1 },
};

/**
 * Cria texturas derivadas do tileset, uma por tipo de móvel.
 * As keys batem com os strings em FurnitureItem.type — assim o
 * OfficeScene.drawFurniture() continua funcionando sem mudanças.
 *
 * Move types com w/h maior que 1 são compostos por múltiplos tiles
 * (ex: sofá ocupa 3×2 tiles do tileset original).
 */
export function registerFurnitureTextures(scene: Phaser.Scene) {
  const sourceKey = "tileset_interiors";
  if (!scene.textures.exists(sourceKey)) {
    console.warn("[FurnitureTiles] tileset ainda não carregado");
    return;
  }
  const sourceImg = scene.textures.get(sourceKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;

  for (const [key, def] of Object.entries(FURNITURE_TILES)) {
    if (scene.textures.exists(key)) {
      // Já existe (provavelmente o canvas do SpriteFactory). Remove pra
      // substituir pelo tile do LimeZu.
      scene.textures.remove(key);
    }
    const tilesW = def.w ?? 1;
    const tilesH = def.h ?? 1;
    const w = tilesW * TILE_SIZE;
    const h = tilesH * TILE_SIZE;
    const canvasTex = scene.textures.createCanvas(key, w, h);
    if (!canvasTex) continue;
    canvasTex.context.drawImage(
      sourceImg,
      def.col * TILE_SIZE, def.row * TILE_SIZE, w, h, // source rect
      0, 0, w, h                                        // dest
    );
    canvasTex.refresh();
  }
}
