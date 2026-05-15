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

/** Helper pra adicionar uma mesa com chair, monitor e deskId estável. */
function addWorkstation(items: FurnitureItem[], desks: Array<{ id: string; x: number; y: number }>, id: string, tileX: number, tileY: number) {
  const x = tileX * TILE;
  const y = tileY * TILE;
  desks.push({ id, x, y });
  items.push({ type: "desk", x, y, depth: 1, hitbox: HITBOXES.desk, deskId: id });
  items.push({ type: "monitor", x, y: y - 18, depth: 2 });
  items.push({ type: "chair", x, y: y + 36, depth: 0, hitbox: HITBOXES.chair });
}

export function getDefaultLayout(): OfficeLayoutData {
  const W_TILES = 80;
  const H_TILES = 55;
  const items: FurnitureItem[] = [];
  const desks: Array<{ id: string; x: number; y: number }> = [];

  const walls: Wall[] = [];
  for (const z of ZONES) {
    walls.push(...wallsForZone(z));
  }

  const rooms: Room[] = ZONES.map((z) => ({
    id: z.id,
    label: z.label,
    x: z.x * TILE,
    y: z.y * TILE,
    w: z.w * TILE,
    h: z.h * TILE,
  }));

  // ============================================================
  // Fase B: Mobília
  // Distribui mesas reserváveis nas 4 áreas de trabalho + decoração
  // ============================================================

  // --- DESENVOLVIMENTO (dev_area, x=20-60, y=0-11) — 8 mesas em 2 fileiras ---
  // Fileira 1 (y=4), Fileira 2 (y=8)
  [24, 30, 36, 42].forEach((tx, i) => addWorkstation(items, desks, `desk-${i + 1}`, tx, 4));
  [24, 30, 36, 42].forEach((tx, i) => addWorkstation(items, desks, `desk-${i + 5}`, tx, 8));
  // Plantas + bebedouro
  items.push({ type: "plant", x: 22 * TILE, y: 2 * TILE, depth: 1, hitbox: HITBOXES.plant });
  items.push({ type: "plant", x: 58 * TILE, y: 2 * TILE, depth: 1, hitbox: HITBOXES.plant });

  // --- DADOS (data_area, x=20-60, y=11-21) — 5 mesas ---
  [24, 30, 36, 42, 48].forEach((tx, i) => addWorkstation(items, desks, `desk-${i + 9}`, tx, 16));
  items.push({ type: "whiteboard", x: 56 * TILE, y: 12 * TILE, depth: 1, hitbox: HITBOXES.whiteboard });
  items.push({ type: "plant", x: 22 * TILE, y: 19 * TILE, depth: 1, hitbox: HITBOXES.plant });

  // --- INFRA (infra_area, y=21-31) — 5 mesas ---
  [24, 30, 36, 42, 48].forEach((tx, i) => addWorkstation(items, desks, `desk-${i + 14}`, tx, 26));
  // "Rack" — usa bookshelf como placeholder
  items.push({ type: "bookshelf", x: 56 * TILE, y: 23 * TILE, depth: 1, hitbox: HITBOXES.bookshelf });
  items.push({ type: "plant", x: 22 * TILE, y: 29 * TILE, depth: 1, hitbox: HITBOXES.plant });

  // --- FINANCEIRO (finance_area, y=31-42) — 5 mesas ---
  [24, 30, 36, 42, 48].forEach((tx, i) => addWorkstation(items, desks, `desk-${i + 19}`, tx, 36));
  items.push({ type: "bookshelf", x: 22 * TILE, y: 33 * TILE, depth: 1, hitbox: HITBOXES.bookshelf });
  items.push({ type: "plant", x: 58 * TILE, y: 40 * TILE, depth: 1, hitbox: HITBOXES.plant });

  // --- DIRETORIAS (office_1, office_2) — mesa executiva grande + visitante ---
  // Office 1 (x=0-20, y=0-9)
  items.push({ type: "desk", x: 8 * TILE, y: 4 * TILE, depth: 1, hitbox: HITBOXES.desk });
  items.push({ type: "monitor", x: 8 * TILE, y: 4 * TILE - 18, depth: 2 });
  items.push({ type: "chair", x: 8 * TILE, y: 5 * TILE + 16, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "chair", x: 12 * TILE, y: 4 * TILE, depth: 0, hitbox: HITBOXES.chair }); // visitante
  items.push({ type: "bookshelf", x: 2 * TILE, y: 2 * TILE, depth: 1, hitbox: HITBOXES.bookshelf });
  items.push({ type: "plant", x: 17 * TILE, y: 7 * TILE, depth: 1, hitbox: HITBOXES.plant });
  // Office 2
  items.push({ type: "desk", x: 8 * TILE, y: 13 * TILE, depth: 1, hitbox: HITBOXES.desk });
  items.push({ type: "monitor", x: 8 * TILE, y: 13 * TILE - 18, depth: 2 });
  items.push({ type: "chair", x: 8 * TILE, y: 14 * TILE + 16, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "chair", x: 12 * TILE, y: 13 * TILE, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "bookshelf", x: 2 * TILE, y: 11 * TILE, depth: 1, hitbox: HITBOXES.bookshelf });
  items.push({ type: "plant", x: 17 * TILE, y: 16 * TILE, depth: 1, hitbox: HITBOXES.plant });

  // --- RECEPÇÃO (lobby) — sofás + plantas + notice board ---
  items.push({ type: "sofa", x: 4 * TILE, y: 22 * TILE, depth: 1, hitbox: HITBOXES.sofa });
  items.push({ type: "sofa", x: 9 * TILE, y: 22 * TILE, depth: 1, hitbox: HITBOXES.sofa });
  items.push({ type: "coffeeTable", x: 6 * TILE, y: 24 * TILE, depth: 2, hitbox: HITBOXES.coffeeTable });
  items.push({ type: "plant", x: 1 * TILE, y: 25 * TILE, depth: 1, hitbox: HITBOXES.plant });
  items.push({ type: "plant", x: 12 * TILE, y: 25 * TILE, depth: 1, hitbox: HITBOXES.plant });
  // Quadro de avisos (placeholder usando whiteboard, na parede norte)
  items.push({ type: "whiteboard", x: 7 * TILE, y: 19 * TILE, depth: 1, hitbox: HITBOXES.whiteboard, tag: "notice_board" });

  // --- COPA — mesa redonda no centro, "geladeira/fogão" placeholders ---
  items.push({ type: "coffeeTable", x: 7 * TILE, y: 32 * TILE, depth: 1, hitbox: HITBOXES.coffeeTable });
  // Cadeiras em volta
  items.push({ type: "chair", x: 5 * TILE, y: 32 * TILE, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "chair", x: 9 * TILE, y: 32 * TILE, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "chair", x: 7 * TILE, y: 30 * TILE, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "chair", x: 7 * TILE, y: 34 * TILE, depth: 0, hitbox: HITBOXES.chair });
  // "Bancada/geladeira/fogão" placeholders com bookshelf + tags
  items.push({ type: "bookshelf", x: 2 * TILE, y: 28 * TILE, depth: 1, hitbox: HITBOXES.bookshelf, tag: "fridge" });
  items.push({ type: "bookshelf", x: 4 * TILE, y: 28 * TILE, depth: 1, hitbox: HITBOXES.bookshelf, tag: "stove" });
  items.push({ type: "bookshelf", x: 10 * TILE, y: 28 * TILE, depth: 1, hitbox: HITBOXES.bookshelf, tag: "coffee_machine" });
  items.push({ type: "bookshelf", x: 12 * TILE, y: 28 * TILE, depth: 1, hitbox: HITBOXES.bookshelf, tag: "microwave" });
  items.push({ type: "plant", x: 12 * TILE, y: 36 * TILE, depth: 1, hitbox: HITBOXES.plant });

  // --- SEGURANÇA — mesa com monitor de câmera ---
  items.push({ type: "desk", x: 5 * TILE, y: 41 * TILE, depth: 1, hitbox: HITBOXES.desk });
  items.push({ type: "monitor", x: 5 * TILE, y: 41 * TILE - 18, depth: 2 });
  items.push({ type: "monitor", x: 8 * TILE, y: 41 * TILE - 18, depth: 2 });
  items.push({ type: "chair", x: 5 * TILE, y: 42 * TILE, depth: 0, hitbox: HITBOXES.chair });

  // --- REUNIÃO XG (sala grande, executiva) ---
  items.push({ type: "desk", x: 70 * TILE, y: 4 * TILE, depth: 1, hitbox: HITBOXES.desk });
  items.push({ type: "desk", x: 70 * TILE, y: 6 * TILE, depth: 1, hitbox: HITBOXES.desk });
  // Cadeiras em volta
  [66, 70, 74].forEach((tx) => {
    items.push({ type: "chair", x: tx * TILE, y: 3 * TILE, depth: 0, hitbox: HITBOXES.chair });
    items.push({ type: "chair", x: tx * TILE, y: 8 * TILE, depth: 0, hitbox: HITBOXES.chair });
  });
  items.push({ type: "tv", x: 70 * TILE, y: 1 * TILE, depth: 1, hitbox: HITBOXES.tv });
  items.push({ type: "plant", x: 62 * TILE, y: 9 * TILE, depth: 1, hitbox: HITBOXES.plant });

  // --- REUNIÕES P / M / G (coluna direita) — cada uma com mesa+cadeiras ---
  const meetings = [
    { y: 13, h: 5, chairs: 4 }, // p1
    { y: 18, h: 5, chairs: 4 }, // p2
    { y: 23, h: 5, chairs: 4 }, // p3
    { y: 28, h: 5, chairs: 4 }, // p4
    { y: 33, h: 6, chairs: 6 }, // m1
    { y: 39, h: 6, chairs: 6 }, // m2
    { y: 45, h: 6, chairs: 8 }, // g1
    { y: 51, h: 6, chairs: 8 }, // g2
  ];
  for (const m of meetings) {
    const cx = 70;
    const cy = m.y + Math.floor(m.h / 2);
    items.push({ type: "coffeeTable", x: cx * TILE, y: cy * TILE, depth: 1, hitbox: HITBOXES.coffeeTable });
    // Distribui cadeiras em volta
    const half = Math.floor(m.chairs / 2);
    for (let i = 0; i < half; i++) {
      items.push({ type: "chair", x: (cx - 2 + i) * TILE, y: (cy - 1) * TILE, depth: 0, hitbox: HITBOXES.chair });
      items.push({ type: "chair", x: (cx - 2 + i) * TILE, y: (cy + 1) * TILE, depth: 0, hitbox: HITBOXES.chair });
    }
  }

  // --- LOUNGE (faixa inferior, 0-60 horizontal, 43-55 vertical) ---
  // Sofás em ângulo, pebolim, sinuca placeholders
  items.push({ type: "sofa", x: 8 * TILE, y: 47 * TILE, depth: 1, hitbox: HITBOXES.sofa });
  items.push({ type: "sofa", x: 14 * TILE, y: 47 * TILE, depth: 1, hitbox: HITBOXES.sofa });
  items.push({ type: "coffeeTable", x: 11 * TILE, y: 49 * TILE, depth: 2, hitbox: HITBOXES.coffeeTable });
  items.push({ type: "sofa", x: 26 * TILE, y: 47 * TILE, depth: 1, hitbox: HITBOXES.sofa });
  items.push({ type: "sofa", x: 32 * TILE, y: 47 * TILE, depth: 1, hitbox: HITBOXES.sofa });
  items.push({ type: "coffeeTable", x: 29 * TILE, y: 49 * TILE, depth: 2, hitbox: HITBOXES.coffeeTable });
  // Plantas
  items.push({ type: "plant", x: 2 * TILE, y: 45 * TILE, depth: 1, hitbox: HITBOXES.plant });
  items.push({ type: "plant", x: 56 * TILE, y: 45 * TILE, depth: 1, hitbox: HITBOXES.plant });
  items.push({ type: "plant", x: 30 * TILE, y: 53 * TILE, depth: 1, hitbox: HITBOXES.plant });
  // "Pebolim" e "Sinuca" — placeholders com coffeeTable maior
  items.push({ type: "coffeeTable", x: 42 * TILE, y: 47 * TILE, depth: 1, hitbox: HITBOXES.coffeeTable, tag: "foosball" });
  items.push({ type: "coffeeTable", x: 50 * TILE, y: 47 * TILE, depth: 1, hitbox: HITBOXES.coffeeTable, tag: "pool_table" });
  // "TV grande" na parede sul
  items.push({ type: "tv", x: 30 * TILE, y: 44 * TILE, depth: 1, hitbox: HITBOXES.tv, tag: "tv_screen" });

  const floorRegions: OfficeLayoutData["floorRegions"] = [];

  // Expõe deskIds usados pra o server gerar o catálogo
  // (em runtime, server e client têm que estar em sync via desks.ts)
  return {
    width: W_TILES * TILE,
    height: H_TILES * TILE,
    floorRegions,
    furniture: items,
    walls,
    rooms,
  };
}

/** Lista de deskIds + posições, exportada pra debugging.
 *  O server tem que ter os mesmos IDs+coords em desks.ts. */
export function getDeskCatalog(): Array<{ id: string; x: number; y: number }> {
  const desks: Array<{ id: string; x: number; y: number }> = [];
  // Espelha a lógica de addWorkstation acima (mesmas coords)
  [24, 30, 36, 42].forEach((tx, i) => desks.push({ id: `desk-${i + 1}`, x: tx * TILE, y: 4 * TILE }));
  [24, 30, 36, 42].forEach((tx, i) => desks.push({ id: `desk-${i + 5}`, x: tx * TILE, y: 8 * TILE }));
  [24, 30, 36, 42, 48].forEach((tx, i) => desks.push({ id: `desk-${i + 9}`, x: tx * TILE, y: 16 * TILE }));
  [24, 30, 36, 42, 48].forEach((tx, i) => desks.push({ id: `desk-${i + 14}`, x: tx * TILE, y: 26 * TILE }));
  [24, 30, 36, 42, 48].forEach((tx, i) => desks.push({ id: `desk-${i + 19}`, x: tx * TILE, y: 36 * TILE }));
  return desks;
}

/**
 * Verifica colisão entre um retângulo (avatar) e qualquer hitbox de móvel,
 * parede estática OU portas fechadas dinâmicas (extraWalls).
 */
export function checkCollision(
  px: number,
  py: number,
  playerHalfSize: number,
  layout: OfficeLayoutData,
  extraWalls?: Wall[]
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

  if (extraWalls) {
    for (const wall of extraWalls) {
      if (pRight > wall.x && pLeft < wall.x + wall.w && pBottom > wall.y && pTop < wall.y + wall.h) {
        return true;
      }
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
