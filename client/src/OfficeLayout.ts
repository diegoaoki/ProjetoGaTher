/**
 * Layout declarativo do escritório com hitboxes pra colisão.
 *
 * hitbox: { offsetX, offsetY, w, h } relativo à posição central do sprite.
 * Se não definido, item não bloqueia movimento.
 */

export interface Hitbox {
  offsetX: number; // deslocamento do centro do sprite
  offsetY: number;
  w: number;
  h: number;
}

export interface FurnitureItem {
  type: string;
  x: number;
  y: number;
  depth?: number;
  hitbox?: Hitbox;
  // Marca itens especiais (TV de apresentação, etc)
  tag?: "tv" | "meeting-zone";
  // Pra mesas reserváveis: id estável que bate com o catálogo do server
  deskId?: string;
}

export interface OfficeLayoutData {
  width: number;
  height: number;
  floorRegions: Array<{ x: number; y: number; w: number; h: number; type: "carpet" | "rug" }>;
  furniture: FurnitureItem[];
  // Zonas especiais com função (ex: "perto da TV mostra tela compartilhada")
  zones: Array<{ id: string; x: number; y: number; w: number; h: number; tag: "presentation" }>;
}

// Hitboxes padronizadas por tipo de móvel
// Coordenadas relativas ao CENTRO do sprite
const HITBOXES: Record<string, Hitbox> = {
  desk:        { offsetX: -48, offsetY: -10, w: 96, h: 32 },
  chair:       { offsetX: -16, offsetY: -10, w: 32, h: 24 },
  sofa:        { offsetX: -40, offsetY: -16, w: 80, h: 32 },
  coffeeTable: { offsetX: -24, offsetY: -10, w: 48, h: 20 },
  plant:       { offsetX: -14, offsetY: -8,  w: 28, h: 24 },
  whiteboard:  { offsetX: -40, offsetY: -20, w: 80, h: 12 },
  bookshelf:   { offsetX: -24, offsetY: -28, w: 48, h: 56 },
  tv:          { offsetX: -36, offsetY: -28, w: 72, h: 14 },
};

export function getDefaultLayout(): OfficeLayoutData {
  const items: FurnitureItem[] = [];

  const addItem = (type: string, x: number, y: number, depth?: number, tag?: FurnitureItem["tag"]) => {
    items.push({ type, x, y, depth, hitbox: HITBOXES[type], tag });
  };

  // Estações de trabalho — 2 fileiras de 4. IDs sincronizados com server/src/desks.ts
  const desks: Array<[string, number, number]> = [
    ["desk-1", 180, 280], ["desk-2", 310, 280], ["desk-3", 440, 280], ["desk-4", 570, 280],
    ["desk-5", 180, 540], ["desk-6", 310, 540], ["desk-7", 440, 540], ["desk-8", 570, 540],
  ];
  desks.forEach(([id, x, y]) => {
    items.push({ type: "desk", x, y, depth: 1, hitbox: HITBOXES.desk, deskId: id });
    items.push({ type: "monitor", x, y: y - 18, depth: 2 }); // monitor sem colisão (fica em cima da mesa)
    addItem("chair", x, y + 36, 0);
  });

  // Lounge
  addItem("sofa", 800, 800, 1);
  addItem("coffeeTable", 800, 860, 2);
  addItem("plant", 750, 770, 3);
  addItem("plant", 870, 770, 3);

  // Whiteboard + TV de apresentação (área de reunião superior esquerda)
  addItem("whiteboard", 120, 130, 0);
  addItem("tv", 260, 130, 0, "tv"); // TV ao lado do whiteboard

  // Estantes
  addItem("bookshelf", 80, 460, 1);
  addItem("bookshelf", 80, 540, 1);

  // Plantas decorativas
  addItem("plant", 130, 800, 3);
  addItem("plant", 880, 200, 3);
  addItem("plant", 480, 920, 3);

  return {
    width: 1024,
    height: 1024,
    floorRegions: [
      { x: 720, y: 760, w: 220, h: 160, type: "rug" },
      { x: 60, y: 80, w: 340, h: 200, type: "rug" }, // área aumentada pra cobrir TV+whiteboard
    ],
    furniture: items,
    zones: [
      // Quem entra aqui vê a tela compartilhada na TV
      { id: "meeting-area", x: 60, y: 80, w: 340, h: 280, tag: "presentation" },
    ],
  };
}

/**
 * Verifica colisão entre um retângulo (avatar) e qualquer hitbox de móvel.
 * playerHalfSize: meia-largura/altura do avatar (raio efetivo de colisão)
 */
export function checkCollision(
  px: number,
  py: number,
  playerHalfSize: number,
  layout: OfficeLayoutData
): boolean {
  const pLeft = px - playerHalfSize;
  const pRight = px + playerHalfSize;
  const pTop = py - playerHalfSize / 2; // colisão só na parte inferior do avatar (estilo top-down clássico)
  const pBottom = py + playerHalfSize;

  for (const item of layout.furniture) {
    if (!item.hitbox) continue;
    const hb = item.hitbox;
    const hLeft = item.x + hb.offsetX;
    const hRight = hLeft + hb.w;
    const hTop = item.y + hb.offsetY;
    const hBottom = hTop + hb.h;

    if (pRight > hLeft && pLeft < hRight && pBottom > hTop && pTop < hBottom) {
      return true;
    }
  }
  return false;
}

/**
 * Verifica se uma posição está dentro de uma zona especial.
 */
export function getCurrentZone(
  px: number,
  py: number,
  layout: OfficeLayoutData
): { id: string; tag: string } | null {
  for (const zone of layout.zones) {
    if (px >= zone.x && px <= zone.x + zone.w && py >= zone.y && py <= zone.y + zone.h) {
      return { id: zone.id, tag: zone.tag };
    }
  }
  return null;
}
