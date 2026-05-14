/**
 * Layout declarativo do escritório com hitboxes pra colisão e zonas
 * isoladas (cada zona tem áudio independente — quem está em zonas
 * diferentes não se ouve, independente da distância).
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
  tag?: "tv" | "meeting-zone";
  // Pra mesas reserváveis: id estável que bate com o catálogo do server
  deskId?: string;
}

/** Parede com colisão. Usada pra delimitar salas (com vãos pra entrar). */
export interface Wall {
  x: number;       // canto superior esquerdo
  y: number;
  w: number;
  h: number;
}

/** Zona com áudio isolado. Se você está numa Room, só ouve quem também está. */
export interface Room {
  id: string;         // ex: "meeting-large", "open"
  label: string;      // ex: "Sala grande", "Open space" — mostrado no HUD
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OfficeLayoutData {
  width: number;
  height: number;
  floorRegions: Array<{ x: number; y: number; w: number; h: number; type: "carpet" | "rug" }>;
  furniture: FurnitureItem[];
  walls: Wall[];
  rooms: Room[];
}

// Hitboxes padronizadas por tipo de móvel
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

/**
 * Mapa atual:
 *   - Sala Grande (esquerda superior): 2 mesas privadas (desk-1, desk-2)
 *   - Sala Pequena A (esquerda meio): 1 mesa privada (desk-3)
 *   - Sala Pequena B (esquerda baixo): 1 mesa privada (desk-4)
 *   - Open space (direita): 4 mesas (desk-5 a desk-8) + lounge no canto
 *
 * IDs das mesas DEVEM bater com server/src/desks.ts.
 */

export function getDefaultLayout(): OfficeLayoutData {
  const items: FurnitureItem[] = [];

  const addItem = (type: string, x: number, y: number, depth?: number, tag?: FurnitureItem["tag"]) => {
    items.push({ type, x, y, depth, hitbox: HITBOXES[type], tag });
  };

  // === Mesas reserváveis (8 total) ===
  const desks: Array<[string, number, number]> = [
    // Sala grande
    ["desk-1", 160, 200],
    ["desk-2", 320, 200],
    // Sala pequena A
    ["desk-3", 220, 480],
    // Sala pequena B
    ["desk-4", 220, 680],
    // Open space
    ["desk-5", 600, 220],
    ["desk-6", 780, 220],
    ["desk-7", 600, 420],
    ["desk-8", 780, 420],
  ];
  desks.forEach(([id, x, y]) => {
    items.push({ type: "desk", x, y, depth: 1, hitbox: HITBOXES.desk, deskId: id });
    items.push({ type: "monitor", x, y: y - 18, depth: 2 });
    addItem("chair", x, y + 36, 0);
  });

  // === Lounge (open space, canto inferior direito) ===
  addItem("sofa", 780, 800, 1);
  addItem("coffeeTable", 780, 860, 2);
  addItem("plant", 730, 770, 3);
  addItem("plant", 850, 770, 3);

  // === Decoração das salas ===
  addItem("whiteboard", 240, 80, 0);     // sala grande
  addItem("plant", 80, 80, 3);
  addItem("plant", 400, 80, 3);
  addItem("bookshelf", 80, 480, 1);      // sala pequena A
  addItem("bookshelf", 80, 680, 1);      // sala pequena B
  addItem("plant", 480, 920, 3);         // open space
  addItem("plant", 920, 920, 3);

  return {
    width: 1024,
    height: 1024,
    floorRegions: [
      // Salas com tapete pra dar identidade visual
      { x: 60, y: 60, w: 380, h: 320, type: "rug" },   // sala grande
      { x: 60, y: 400, w: 320, h: 180, type: "rug" },  // sala pequena A
      { x: 60, y: 600, w: 320, h: 180, type: "rug" },  // sala pequena B
      { x: 720, y: 760, w: 220, h: 180, type: "rug" }, // lounge
    ],
    furniture: items,
    walls: WALLS,
    rooms: ROOMS,
  };
}

// =================================================================
//  Paredes (com colisão). Cada sala é uma caixa com um vão de 80px
//  pra avatar entrar/sair. WALL_THICKNESS = 8px.
// =================================================================
const WT = 8; // espessura padrão da parede

const WALLS: Wall[] = [
  // === Sala Grande (60,60) → (440,380). Vão na lateral direita, y 200-280 ===
  // top
  { x: 60, y: 60, w: 380, h: WT },
  // left
  { x: 60, y: 60, w: WT, h: 320 },
  // bottom
  { x: 60, y: 372, w: 380, h: WT },
  // right (com vão): de y=60 até y=200, e de y=280 até y=380
  { x: 432, y: 60, w: WT, h: 140 },
  { x: 432, y: 280, w: WT, h: 100 },

  // === Sala Pequena A (60,400) → (380,580). Vão direita y 460-540 ===
  { x: 60, y: 400, w: 320, h: WT },
  { x: 60, y: 400, w: WT, h: 180 },
  { x: 60, y: 572, w: 320, h: WT },
  { x: 372, y: 400, w: WT, h: 60 },
  { x: 372, y: 540, w: WT, h: 40 },

  // === Sala Pequena B (60,600) → (380,780). Vão direita y 660-740 ===
  { x: 60, y: 600, w: 320, h: WT },
  { x: 60, y: 600, w: WT, h: 180 },
  { x: 60, y: 772, w: 320, h: WT },
  { x: 372, y: 600, w: WT, h: 60 },
  { x: 372, y: 740, w: WT, h: 40 },
];

// =================================================================
//  Zonas com áudio isolado.
//  Player dentro de uma room só ouve quem está na mesma.
//  Player fora de qualquer room = zone "open".
// =================================================================
const ROOMS: Room[] = [
  { id: "meeting-large", label: "Sala grande",   x: 60,  y: 60,  w: 380, h: 320 },
  { id: "meeting-a",     label: "Sala pequena A", x: 60,  y: 400, w: 320, h: 180 },
  { id: "meeting-b",     label: "Sala pequena B", x: 60,  y: 600, w: 320, h: 180 },
];

/**
 * Verifica colisão entre um retângulo (avatar) e qualquer hitbox de móvel
 * OU parede.
 */
export function checkCollision(
  px: number,
  py: number,
  playerHalfSize: number,
  layout: OfficeLayoutData
): boolean {
  const pLeft = px - playerHalfSize;
  const pRight = px + playerHalfSize;
  const pTop = py - playerHalfSize / 2;
  const pBottom = py + playerHalfSize;

  // Móveis
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

  // Paredes (hitbox direto: x/y/w/h é o retângulo bloqueante)
  for (const wall of layout.walls) {
    if (pRight > wall.x && pLeft < wall.x + wall.w && pBottom > wall.y && pTop < wall.y + wall.h) {
      return true;
    }
  }

  return false;
}

/**
 * Retorna a Room atual do player. Se está fora de qualquer room
 * delimitada, retorna a zona padrão "open".
 */
export function getCurrentRoom(px: number, py: number, layout: OfficeLayoutData): Room {
  for (const room of layout.rooms) {
    if (px >= room.x && px <= room.x + room.w && py >= room.y && py <= room.y + room.h) {
      return room;
    }
  }
  // Zona implícita "open" — todo lugar fora das salas
  return { id: "open", label: "Open space", x: 0, y: 0, w: layout.width, h: layout.height };
}

// Compatibilidade com chamadas antigas (OfficeScene ainda usa getCurrentZone)
export function getCurrentZone(px: number, py: number, layout: OfficeLayoutData): { id: string; tag: string } | null {
  const room = getCurrentRoom(px, py, layout);
  return { id: room.id, tag: "room" };
}
