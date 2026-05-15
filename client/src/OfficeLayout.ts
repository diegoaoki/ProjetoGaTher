/**
 * Layout do escritório virtual (Fase A do prompt-escritorio.txt).
 *
 * Mapa: 80×55 tiles (32px cada) = 2560×1760 px.
 * 15 zonas distribuídas em 3 colunas:
 *   Esquerda  (col 0-19):  Diretoria 1, Diretoria 2, Recepção, Copa, Segurança
 *   Centro    (col 20-59): Desenvolvimento, Dados, Infra, Financeiro
 *   Direita   (col 60-79): Reunião XG, 4× Reunião P, 2× Reunião M, 2× Reunião G
 *   Inferior  (col 0-59):  Lounge (faixa)
 *
 * Convenção de coordenadas: pixels. 1 tile = 32 px.
 */

export interface Hitbox {
  offsetX: number;
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
  tag?: string;
  deskId?: string;
}

export interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Room {
  id: string;
  label: string;
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

const TILE = 32;
const WALL_T = 8;

// === Definições de zonas em TILES (depois convertidas pra px) ===
type ZoneDef = {
  id: string;
  label: string;
  x: number; y: number;
  w: number; h: number;
  /** Vão na parede (lado, posição em tiles dentro do lado, largura do vão).
   *  side: "top" | "bottom" | "left" | "right". Pode ter múltiplos. */
  openings?: Array<{ side: "top" | "bottom" | "left" | "right"; pos: number; width?: number }>;
};

const ZONES: ZoneDef[] = [
  // === Coluna esquerda ===
  { id: "office_1",       label: "Diretoria 1",        x: 0,  y: 0,  w: 20, h: 9,
    openings: [{ side: "right", pos: 4 }] },
  { id: "office_2",       label: "Diretoria 2",        x: 0,  y: 9,  w: 20, h: 9,
    openings: [{ side: "right", pos: 4 }] },
  { id: "lobby",          label: "Recepção",           x: 0,  y: 18, w: 14, h: 8,
    openings: [{ side: "right", pos: 4, width: 4 }, { side: "bottom", pos: 4, width: 4 }] },
  { id: "kitchen",        label: "Copa",               x: 0,  y: 26, w: 14, h: 12,
    openings: [{ side: "right", pos: 4, width: 4 }] },
  { id: "security_room",  label: "Segurança",          x: 0,  y: 38, w: 14, h: 5,
    openings: [{ side: "right", pos: 2 }] },

  // === Coluna central ===
  { id: "dev_area",       label: "Desenvolvimento",    x: 20, y: 0,  w: 40, h: 11,
    openings: [{ side: "left", pos: 5, width: 3 }] },
  { id: "data_area",      label: "Dados",              x: 20, y: 11, w: 40, h: 10,
    openings: [{ side: "left", pos: 4, width: 3 }] },
  { id: "infra_area",     label: "Infra",              x: 20, y: 21, w: 40, h: 10,
    openings: [{ side: "left", pos: 4, width: 3 }] },
  { id: "finance_area",   label: "Financeiro",         x: 20, y: 31, w: 40, h: 11,
    openings: [{ side: "left", pos: 5, width: 3 }] },

  // === Coluna direita: reuniões ===
  { id: "meeting_xg",     label: "Reunião XG",         x: 60, y: 0,  w: 20, h: 11,
    openings: [{ side: "left", pos: 5 }] },
  { id: "meeting_p1",     label: "Reunião P1",         x: 60, y: 11, w: 20, h: 5,
    openings: [{ side: "left", pos: 2 }] },
  { id: "meeting_p2",     label: "Reunião P2",         x: 60, y: 16, w: 20, h: 5,
    openings: [{ side: "left", pos: 2 }] },
  { id: "meeting_p3",     label: "Reunião P3",         x: 60, y: 21, w: 20, h: 5,
    openings: [{ side: "left", pos: 2 }] },
  { id: "meeting_p4",     label: "Reunião P4",         x: 60, y: 26, w: 20, h: 5,
    openings: [{ side: "left", pos: 2 }] },
  { id: "meeting_m1",     label: "Reunião M1",         x: 60, y: 31, w: 20, h: 6,
    openings: [{ side: "left", pos: 2 }] },
  { id: "meeting_m2",     label: "Reunião M2",         x: 60, y: 37, w: 20, h: 6,
    openings: [{ side: "left", pos: 2 }] },
  { id: "meeting_g1",     label: "Reunião G1",         x: 60, y: 43, w: 20, h: 6,
    openings: [{ side: "left", pos: 2 }] },
  { id: "meeting_g2",     label: "Reunião G2",         x: 60, y: 49, w: 20, h: 6,
    openings: [{ side: "left", pos: 2 }] },

  // === Lounge (faixa inferior) ===
  { id: "lounge",         label: "Lounge",             x: 0,  y: 43, w: 60, h: 12,
    openings: [{ side: "top", pos: 8, width: 4 }, { side: "top", pos: 30, width: 4 }] },
];

/** Gera as 4 paredes de uma zona com vãos (openings) onde definido. */
function wallsForZone(z: ZoneDef): Wall[] {
  const out: Wall[] = [];
  const x = z.x * TILE;
  const y = z.y * TILE;
  const w = z.w * TILE;
  const h = z.h * TILE;

  const sides: Array<{ side: "top" | "bottom" | "left" | "right"; segments: Wall[] }> = [
    { side: "top",    segments: [{ x, y, w, h: WALL_T }] },
    { side: "bottom", segments: [{ x, y: y + h - WALL_T, w, h: WALL_T }] },
    { side: "left",   segments: [{ x, y, w: WALL_T, h }] },
    { side: "right",  segments: [{ x: x + w - WALL_T, y, w: WALL_T, h }] },
  ];

  for (const s of sides) {
    const opening = z.openings?.find((o) => o.side === s.side);
    if (!opening) {
      out.push(...s.segments);
      continue;
    }
    const gapWidth = (opening.width ?? 2) * TILE;
    const gapStart = opening.pos * TILE;

    // Quebra a parede em 2 segmentos com vão no meio
    const seg = s.segments[0];
    if (s.side === "top" || s.side === "bottom") {
      // horizontal
      out.push({ x: seg.x, y: seg.y, w: gapStart, h: seg.h });
      out.push({ x: seg.x + gapStart + gapWidth, y: seg.y, w: seg.w - gapStart - gapWidth, h: seg.h });
    } else {
      // vertical
      out.push({ x: seg.x, y: seg.y, w: seg.w, h: gapStart });
      out.push({ x: seg.x, y: seg.y + gapStart + gapWidth, w: seg.w, h: seg.h - gapStart - gapWidth });
    }
  }
  return out;
}

export function getDefaultLayout(): OfficeLayoutData {
  const W_TILES = 80;
  const H_TILES = 55;
  const items: FurnitureItem[] = [];

  // Gera paredes a partir das zonas + bordas externas
  const walls: Wall[] = [];
  for (const z of ZONES) {
    walls.push(...wallsForZone(z));
  }

  // Rooms em pixels (pra colisão / áudio isolado)
  const rooms: Room[] = ZONES.map((z) => ({
    id: z.id,
    label: z.label,
    x: z.x * TILE,
    y: z.y * TILE,
    w: z.w * TILE,
    h: z.h * TILE,
  }));

  // Tapetes nas zonas (pra dar identidade visual diferente do parquet padrão)
  const floorRegions: OfficeLayoutData["floorRegions"] = [];

  return {
    width: W_TILES * TILE,
    height: H_TILES * TILE,
    floorRegions,
    furniture: items,
    walls,
    rooms,
  };
}

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

  for (const wall of layout.walls) {
    if (pRight > wall.x && pLeft < wall.x + wall.w && pBottom > wall.y && pTop < wall.y + wall.h) {
      return true;
    }
  }

  return false;
}

/** Retorna a Room atual do player; "open" se está fora de qualquer zona. */
export function getCurrentRoom(px: number, py: number, layout: OfficeLayoutData): Room {
  for (const room of layout.rooms) {
    if (px >= room.x && px <= room.x + room.w && py >= room.y && py <= room.y + room.h) {
      return room;
    }
  }
  return { id: "open", label: "Corredor", x: 0, y: 0, w: layout.width, h: layout.height };
}

// Compatibilidade com chamadas antigas
export function getCurrentZone(px: number, py: number, layout: OfficeLayoutData): { id: string; tag: string } | null {
  const room = getCurrentRoom(px, py, layout);
  return { id: room.id, tag: "room" };
}
