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
  /** Estrutura fixa (escada rolante etc.) — o editor de mapa não
   *  pode mover/deletar. Re-anexada em applyLayoutOverride. */
  fixed?: boolean;
  /** Override de textura (mantém `type` p/ lógica; só muda o sprite).
   *  Ex.: desks por departamento (`desk_dev`...). */
  tex?: string;
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
  floorRegions: Array<{ x: number; y: number; w: number; h: number; type: "carpet" | "rug" | "dept"; tint?: number; label?: string }>;
  furniture: FurnitureItem[];
  walls: Wall[];
  rooms: Room[];
}

const HITBOXES: Record<string, Hitbox> = {
  desk:         { offsetX: -48, offsetY: -10, w: 96, h: 32 }, // diretorias (desk procedural largo)
  desk_pc:      { offsetX: -16, offsetY: -2,  w: 32, h: 28 }, // workstation LimeZu 32×64 (C30)
  chair:        { offsetX: -16, offsetY: -10, w: 32, h: 24 },
  sofa:         { offsetX: -40, offsetY: -16, w: 80, h: 32 },
  coffeeTable:  { offsetX: -28, offsetY: -8,  w: 56,  h: 20 }, // LimeZu 64×32
  meetingTable: { offsetX: -88, offsetY: -18, w: 176, h: 56 }, // LimeZu 192×80
  plant:        { offsetX: -14, offsetY: -8,  w: 28, h: 24 },
  whiteboard:   { offsetX: -40, offsetY: -20, w: 80, h: 12 },
  bookshelf:    { offsetX: -24, offsetY: -28, w: 48, h: 56 },
  tv:           { offsetX: -36, offsetY: -28, w: 72, h: 14 },
  // Cozinha (Copa) — LimeZu. Footprint ~ base do sprite (origem central).
  fridge:        { offsetX: -16, offsetY: -28, w: 32, h: 52 },
  stove:         { offsetX: -16, offsetY: -22, w: 32, h: 44 },
  counter_sink:  { offsetX: -16, offsetY: -22, w: 32, h: 44 },
  counter:       { offsetX: -32, offsetY: -24, w: 64, h: 44 },
  coffee_machine:{ offsetX: -14, offsetY: -18, w: 28, h: 36 },
  microwave:     { offsetX: -14, offsetY: -10, w: 28, h: 22 },
  kitchen_table: { offsetX: -58, offsetY: -18, w: 116, h: 56 }, // LimeZu 128×80
  // range_hood é decoração de parede (sem colisão) — não tem hitbox
  // Segurança (sala no-entry; hitboxes só pro editor/consistência)
  cctv_screen:      { offsetX: -30, offsetY: -28, w: 60, h: 52 },
  security_console: { offsetX: -16, offsetY: -20, w: 32, h: 40 },
  server_rack:      { offsetX: -16, offsetY: -16, w: 32, h: 32 },
  security_camera:  { offsetX: -14, offsetY: -28, w: 28, h: 52 },
  crate:            { offsetX: -12, offsetY: -12, w: 24, h: 24 },
  // escalator: sem hitbox de propósito (pisa em cima pra ser teleportado)
};

/** Hitbox padrão de um tipo de móvel (usado pelo editor ao adicionar). */
export function hitboxFor(type: string): Hitbox {
  return HITBOXES[type] || { offsetX: -16, offsetY: -16, w: 32, h: 32 };
}

/** Tipos de móvel disponíveis na paleta do editor de mapa. */
export const EDITOR_FURNITURE_TYPES = [
  "plant", "sofa", "coffeeTable", "bookshelf",
  "whiteboard", "tv", "chair", "meetingTable",
  // Cozinha (Copa)
  "fridge", "stove", "counter", "counter_sink",
  "coffee_machine", "microwave", "kitchen_table", "range_hood",
  // Segurança
  "cctv_screen", "cctv_screen2", "cctv_screen3",
  "security_console", "server_rack", "security_camera",
  // 2º andar
  "crate",
];

const TILE = 32;
export const WALL_T = 12;

// === 2º andar + escada rolante ===
// Floor 1 ocupa y 0..55 tiles. Gap (55..60) inalcançável. Floor 2 abaixo.
const FLOOR2_Y0_TILE = 60;
/** y (px) a partir do qual estamos no 2º andar. */
export const FLOOR2_Y0 = FLOOR2_Y0_TILE * TILE;
/** Andar (1|2) a partir de uma coord Y de mundo. */
export function floorOfY(y: number): number {
  return y >= FLOOR2_Y0 ? 2 : 1;
}
/**
 * Escadas rolantes (fixas, não-editáveis). Pisar no `pad` (raio) estando
 * no andar `fromFloor` → teleporta pra `to` (x,y do andar destino).
 */
export const ESCALATORS: Array<{
  fromFloor: number;
  pad: { x: number; y: number; r: number };
  to: { x: number; y: number; floor: number };
}> = [
  // Térreo: meio do salão (open space central) → sobe pro 2º andar
  {
    fromFloor: 1,
    pad: { x: 40 * TILE, y: 27 * TILE, r: 26 },
    to: { x: 40 * TILE, y: 65 * TILE, floor: 2 },
  },
  // 2º andar: escada de volta → desce pro térreo
  {
    fromFloor: 2,
    pad: { x: 40 * TILE, y: 63 * TILE, r: 26 },
    to: { x: 40 * TILE, y: 29 * TILE, floor: 1 },
  },
];

// === Definições de zonas em TILES (depois convertidas pra px) ===
type ZoneDef = {
  id: string;
  label: string;
  x: number; y: number;
  w: number; h: number;
  /** Vão na parede (lado, posição em tiles dentro do lado, largura do vão).
   *  side: "top" | "bottom" | "left" | "right". Pode ter múltiplos. */
  openings?: Array<{ side: "top" | "bottom" | "left" | "right"; pos: number; width?: number }>;
  /** Se true, zona é "open space" (departamento sem paredes). Continua existindo
   *  como room pra label/áudio, mas sem hitboxes de parede. */
  noWalls?: boolean;
};

const ZONES: ZoneDef[] = [
  // === Coluna esquerda ===
  { id: "office_1",       label: "Diretoria 1",        x: 0,  y: 0,  w: 20, h: 9,
    openings: [{ side: "right", pos: 4 }] },
  { id: "office_2",       label: "Diretoria 2",        x: 0,  y: 9,  w: 20, h: 9,
    openings: [{ side: "right", pos: 4 }] },
  { id: "lobby",          label: "Recepção",           x: 0,  y: 18, w: 14, h: 8,
    openings: [{ side: "right", pos: 4 }] },
  { id: "kitchen",        label: "Copa",               x: 0,  y: 26, w: 14, h: 12,
    openings: [{ side: "right", pos: 4 }] },
  { id: "security_room",  label: "Segurança",          x: 0,  y: 38, w: 14, h: 5,
    openings: [{ side: "right", pos: 2 }] },

  // === Coluna central — open space, sem paredes (departamentos fundidos) ===
  { id: "dev_area",       label: "Desenvolvimento",    x: 20, y: 0,  w: 40, h: 11, noWalls: true },
  { id: "data_area",      label: "Dados",              x: 20, y: 11, w: 40, h: 10, noWalls: true },
  { id: "infra_area",     label: "Infra",              x: 20, y: 21, w: 40, h: 10, noWalls: true },
  { id: "finance_area",   label: "Financeiro",         x: 20, y: 31, w: 40, h: 11, noWalls: true },

  // === Coluna direita: reuniões (P1, P2 e M2 removidas — restam 4 salas grandes) ===
  { id: "meeting_xg",     label: "Reunião XG",         x: 60, y: 0,  w: 20, h: 17,
    openings: [{ side: "left", pos: 8 }] },
  { id: "meeting_m1",     label: "Reunião M1",         x: 60, y: 17, w: 20, h: 12,
    openings: [{ side: "left", pos: 5 }] },
  { id: "meeting_g1",     label: "Reunião G1",         x: 60, y: 29, w: 20, h: 13,
    openings: [{ side: "left", pos: 5 }] },
  { id: "meeting_g2",     label: "Reunião G2",         x: 60, y: 42, w: 20, h: 13,
    openings: [{ side: "left", pos: 5 }] },

  // === Lounge (faixa inferior) — w=58 deixa um corredor de 2 tiles (x=58-60)
  //     entre o lounge e as salas de reunião. 4 aberturas top dentro do open
  //     space dos departamentos (x ≥ 14) pra não conflitar com a Segurança. ===
  { id: "lounge",         label: "Lounge",             x: 0,  y: 43, w: 58, h: 12,
    openings: [{ side: "top", pos: 36, width: 5.2 }] },

  // === 2º andar (y ≥ 60) — sala grande FECHADA (só se chega via escada
  //     rolante). Sem openings = perímetro todo com parede. Interior
  //     editável pelo admin; começa quase vazia + caixas num canto. ===
  { id: "floor2",         label: "2º Andar",           x: 10, y: 60, w: 60, h: 24 },
];

/**
 * Dedup com SPLIT: quando duas walls adjacentes se sobrepõem (parcial ou
 * totalmente), a primeira a entrar vence; a candidate é dividida nos
 * trechos que NÃO sobrepõem e cada segmento é re-tentado recursivamente.
 *
 * Resolve o caso "duas paredes lado a lado" mesmo quando uma é maior que a
 * outra (ex: office_2 bottom w=640 vs lobby top w=448). Mantém a primeira
 * inteira e descarta a parte sobreposta da segunda, mantendo o resto.
 */
function pushWallDedup(walls: Wall[], cand: Wall): void {
  const candH = cand.h <= WALL_T && cand.w > WALL_T;
  const candV = cand.w <= WALL_T && cand.h > WALL_T;

  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const wH = w.h <= WALL_T && w.w > WALL_T;
    const wV = w.w <= WALL_T && w.h > WALL_T;

    if (candH && wH && Math.abs(w.y - cand.y) <= WALL_T) {
      const overlapStart = Math.max(w.x, cand.x);
      const overlapEnd = Math.min(w.x + w.w, cand.x + cand.w);
      if (overlapEnd <= overlapStart) continue;
      const segments: Wall[] = [];
      if (cand.x < overlapStart) segments.push({ x: cand.x, y: cand.y, w: overlapStart - cand.x, h: cand.h });
      if (cand.x + cand.w > overlapEnd) segments.push({ x: overlapEnd, y: cand.y, w: cand.x + cand.w - overlapEnd, h: cand.h });
      for (const seg of segments) pushWallDedup(walls, seg);
      return;
    }

    if (candV && wV && Math.abs(w.x - cand.x) <= WALL_T) {
      const overlapStart = Math.max(w.y, cand.y);
      const overlapEnd = Math.min(w.y + w.h, cand.y + cand.h);
      if (overlapEnd <= overlapStart) continue;
      const segments: Wall[] = [];
      if (cand.y < overlapStart) segments.push({ x: cand.x, y: cand.y, w: cand.w, h: overlapStart - cand.y });
      if (cand.y + cand.h > overlapEnd) segments.push({ x: cand.x, y: overlapEnd, w: cand.w, h: cand.y + cand.h - overlapEnd });
      for (const seg of segments) pushWallDedup(walls, seg);
      return;
    }
  }
  walls.push(cand);
}

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
    const gapWidth = (opening.width ?? 2.6) * TILE;
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
  // Desk por departamento (sprite com PC embutido). `type` continua
  // "desk" pra não quebrar reserva/overlay/spawn — só a textura muda.
  const tex =
    tileY < 11 ? "deskpc_dev" :
    tileY < 21 ? "deskpc_dados" :
    tileY < 31 ? "deskpc_infra" : "deskpc_fin";
  items.push({ type: "desk", x, y, depth: 1, hitbox: HITBOXES.desk_pc, deskId: id, tex });
  items.push({ type: "chair", x, y: y + 36, depth: 0, hitbox: HITBOXES.chair });
}

export function getDefaultLayout(): OfficeLayoutData {
  const W_TILES = 80;
  const H_TILES = 85; // 55 (térreo) + gap + 2º andar (y 60..84)
  const items: FurnitureItem[] = [];
  const desks: Array<{ id: string; x: number; y: number }> = [];

  const walls: Wall[] = [];
  for (const z of ZONES) {
    if (z.noWalls) continue;
    for (const w of wallsForZone(z)) pushWallDedup(walls, w);
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

  // --- DIRETORIAS (office_1, office_2) — sala inteira é "assumida" pelo admin
  //     que reserva a mesa. deskId admin-only no server (ver desks.ts). ---
  // Office 1 (x=0-20, y=0-9)
  items.push({ type: "desk", x: 8 * TILE, y: 4 * TILE, depth: 1, hitbox: HITBOXES.desk, deskId: "office_1" });
  items.push({ type: "monitor", x: 8 * TILE, y: 4 * TILE - 18, depth: 2 });
  items.push({ type: "chair", x: 8 * TILE, y: 5 * TILE + 16, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "chair", x: 12 * TILE, y: 4 * TILE, depth: 0, hitbox: HITBOXES.chair }); // visitante
  items.push({ type: "bookshelf", x: 2 * TILE, y: 2 * TILE, depth: 1, hitbox: HITBOXES.bookshelf });
  items.push({ type: "plant", x: 17 * TILE, y: 7 * TILE, depth: 1, hitbox: HITBOXES.plant });
  // Office 2
  items.push({ type: "desk", x: 8 * TILE, y: 13 * TILE, depth: 1, hitbox: HITBOXES.desk, deskId: "office_2" });
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

  // --- COPA — cozinha de verdade (sprites LimeZu pago, Kitchen Singles) ---
  // Bancada CONTÍNUA encostada na parede de cima: todas as peças com a
  // MESMA base (baseY) → bottoms alinhados, sem flutuar. Balcões coladas
  // (a cada 64px) formam o corpo; fogão/pia/geladeira embutidos; cafeteira
  // e microondas "em cima" (y maior = depth na frente do balcão).
  const baseY = 29 * TILE; // linha do chão onde a bancada encosta
  const bot = (h: number) => baseY - h / 2; // y p/ alinhar o bottom do sprite
  // Corpo do balcão (64×64) — colado, varrendo a parede
  for (const cx of [128, 192, 256, 320, 384]) {
    items.push({ type: "counter", x: cx, y: bot(64), depth: 1, hitbox: HITBOXES.counter });
  }
  // Embutidos (depois dos balcões → desenham por cima)
  items.push({ type: "fridge",       x: 64,  y: bot(80), depth: 1, hitbox: HITBOXES.fridge });
  items.push({ type: "stove",        x: 160, y: bot(64), depth: 1, hitbox: HITBOXES.stove });
  items.push({ type: "counter_sink", x: 288, y: bot(64), depth: 1, hitbox: HITBOXES.counter_sink });
  // Eletro de bancada (y maior → na frente do balcão)
  items.push({ type: "coffee_machine", x: 352, y: bot(48), depth: 1, hitbox: HITBOXES.coffee_machine });
  items.push({ type: "microwave",      x: 224, y: bot(32), depth: 1, hitbox: HITBOXES.microwave });
  // Coifa na parede, acima do fogão (decoração, sem colisão)
  items.push({ type: "range_hood", x: 160, y: 26 * TILE, depth: 1 });

  // Área de refeição: mesa 64×64 + 4 cadeiras + planta no canto
  const tx = 7 * TILE, ty = 34 * TILE;
  items.push({ type: "kitchen_table", x: tx, y: ty, depth: 1, hitbox: HITBOXES.kitchen_table });
  items.push({ type: "chair", x: tx - 64, y: ty, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "chair", x: tx + 64, y: ty, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "chair", x: tx, y: ty - 56, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "chair", x: tx, y: ty + 56, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "plant", x: 12 * TILE, y: 37 * TILE, depth: 1, hitbox: HITBOXES.plant });

  // --- SEGURANÇA — sala de monitoramento (sprites LimeZu TV Studio).
  // Sala no-entry (ninguém entra) — vista de fora pelo corredor. Parede
  // de monitores CCTV em cima, consoles + cadeiras, rack e câmera.
  // Parede de monitores (64×64) encostada no topo da sala (y=38 tiles)
  items.push({ type: "cctv_screen",  x: 3 * TILE,  y: 39 * TILE, depth: 1, hitbox: HITBOXES.cctv_screen });
  items.push({ type: "cctv_screen2", x: 6 * TILE,  y: 39 * TILE, depth: 1, hitbox: HITBOXES.cctv_screen });
  items.push({ type: "cctv_screen3", x: 9 * TILE,  y: 39 * TILE, depth: 1, hitbox: HITBOXES.cctv_screen });
  items.push({ type: "cctv_screen",  x: 12 * TILE, y: 39 * TILE, depth: 1, hitbox: HITBOXES.cctv_screen });
  // Consoles de controle + cadeiras do operador
  items.push({ type: "security_console", x: 4 * TILE, y: 41 * TILE, depth: 1, hitbox: HITBOXES.security_console });
  items.push({ type: "chair", x: 4 * TILE, y: 42 * TILE, depth: 0, hitbox: HITBOXES.chair });
  items.push({ type: "security_console", x: 8 * TILE, y: 41 * TILE, depth: 1, hitbox: HITBOXES.security_console });
  items.push({ type: "chair", x: 8 * TILE, y: 42 * TILE, depth: 0, hitbox: HITBOXES.chair });
  // Rack de equipamentos + câmera nos cantos
  items.push({ type: "server_rack",     x: 12 * TILE, y: 41 * TILE, depth: 1, hitbox: HITBOXES.server_rack });
  items.push({ type: "security_camera", x: 1 * TILE,  y: 41 * TILE, depth: 1, hitbox: HITBOXES.security_camera });
  items.push({ type: "plant", x: 13 * TILE, y: 42 * TILE, depth: 1, hitbox: HITBOXES.plant });

  // --- TODAS AS SALAS DE REUNIÃO — mesa retangular grande no centro + cadeiras ao redor ---
  // Helper: mesa de reunião 5×2 tiles + 3 cadeiras em cima/baixo + 1 em cada extremidade
  const buildMeetingRoom = (cx: number, cy: number) => {
    items.push({ type: "meetingTable", x: cx * TILE, y: cy * TILE, depth: 1, hitbox: HITBOXES.meetingTable });
    // 3 cadeiras topo + 3 cadeiras embaixo (alinhadas com tampo da mesa)
    [-2, 0, 2].forEach((dx) => {
      items.push({ type: "chair", x: (cx + dx) * TILE, y: (cy - 1.5) * TILE, depth: 0, hitbox: HITBOXES.chair });
      items.push({ type: "chair", x: (cx + dx) * TILE, y: (cy + 1.5) * TILE, depth: 0, hitbox: HITBOXES.chair });
    });
    // cabeceiras (extremidades) — 1 cadeira de cada lado
    items.push({ type: "chair", x: (cx - 3) * TILE, y: cy * TILE, depth: 0, hitbox: HITBOXES.chair });
    items.push({ type: "chair", x: (cx + 3) * TILE, y: cy * TILE, depth: 0, hitbox: HITBOXES.chair });
  };

  // Reunião XG (sala grande, executiva): mesa central + TV na parede norte
  buildMeetingRoom(70, 8);
  items.push({ type: "tv", x: 70 * TILE, y: 1 * TILE, depth: 1, hitbox: HITBOXES.tv });
  items.push({ type: "plant", x: 62 * TILE, y: 15 * TILE, depth: 1, hitbox: HITBOXES.plant });

  // Demais reuniões (M/G) — todas com a mesma mesa de reunião no centro
  const meetingRooms = [
    { y: 17, h: 12 }, // m1
    { y: 29, h: 13 }, // g1
    { y: 42, h: 13 }, // g2
  ];
  for (const m of meetingRooms) {
    buildMeetingRoom(70, m.y + Math.floor(m.h / 2));
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

  // --- ESCADA ROLANTE (fixa, não-editável) — meio do salão sobe pro
  //     2º andar; escada de volta no 2º andar. Sem hitbox: pisa em cima
  //     (server detecta e teleporta). Posições espelham ESCALATORS. ---
  items.push({ type: "escalator", x: 40 * TILE, y: 27 * TILE, depth: 1, fixed: true, tag: "escalator_up" });
  items.push({ type: "escalator", x: 40 * TILE, y: 63 * TILE, depth: 1, fixed: true, tag: "escalator_down" });

  // --- 2º ANDAR — começa quase vazio: só caixas num canto pro admin
  //     editar como quiser (interior é editável; perímetro/escada não). ---
  [
    [13, 81], [15, 81], [17, 81], [13, 79], [15, 79],
  ].forEach(([tx, ty]) => {
    items.push({ type: "crate", x: tx * TILE, y: ty * TILE, depth: 1, hitbox: HITBOXES.crate });
  });

  // Tints sutis pra distinguir os 4 departamentos no open space central
  const floorRegions: OfficeLayoutData["floorRegions"] = [
    { x: 20 * TILE, y: 0,         w: 40 * TILE, h: 11 * TILE, type: "dept", tint: 0xb8d4ff, label: "Desenvolvimento" }, // azul
    { x: 20 * TILE, y: 11 * TILE, w: 40 * TILE, h: 10 * TILE, type: "dept", tint: 0xc8e8c8, label: "Dados" },          // verde
    { x: 20 * TILE, y: 21 * TILE, w: 40 * TILE, h: 10 * TILE, type: "dept", tint: 0xffd9a8, label: "Infra" },          // laranja
    { x: 20 * TILE, y: 31 * TILE, w: 40 * TILE, h: 11 * TILE, type: "dept", tint: 0xe0c8ff, label: "Financeiro" },     // roxo
  ];

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
  const pTop = py - playerHalfSize;       // simétrico — mesmo encosto em cima e em baixo
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

/**
 * Aplica um override do editor (mobília + paredes) sobre o layout base.
 * Substitui as camadas editáveis inteiras quando o override existe;
 * zonas/salas/floorRegions/portas continuam do código (não editáveis).
 */
export function applyLayoutOverride(
  base: OfficeLayoutData,
  override: { furniture?: FurnitureItem[]; walls?: Wall[] } | null | undefined
): OfficeLayoutData {
  if (!override) return base;
  const fixed = base.furniture.filter((f) => f.fixed); // escada rolante etc.
  const useOverrideFurn =
    Array.isArray(override.furniture) && override.furniture.length > 0;
  return {
    ...base,
    // Móveis: usa o override, mas SEMPRE re-anexa os fixos do código
    // (e remove fixos que tenham vazado pro override) → escada rolante
    // não pode ser movida/apagada nem some por override antigo.
    furniture: useOverrideFurn
      ? [...override.furniture!.filter((f) => !f.fixed), ...fixed]
      : base.furniture,
    walls:
      Array.isArray(override.walls) && override.walls.length > 0
        ? override.walls
        : base.walls,
  };
}

// Compatibilidade com chamadas antigas
export function getCurrentZone(px: number, py: number, layout: OfficeLayoutData): { id: string; tag: string } | null {
  const room = getCurrentRoom(px, py, layout);
  return { id: room.id, tag: "room" };
}
