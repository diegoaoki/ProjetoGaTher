/**
 * Catálogo de portas funcionais do mapa.
 * Coords (em pixels, centro da porta) calculadas a partir dos openings
 * definidos em `client/src/OfficeLayout.ts`. Mantenha em sync.
 */

const TILE = 32;
const WALL_T = 12; // precisa ficar em sync com WALL_T do client/OfficeLayout.ts

export interface DoorConfig {
  doorId: string;
  x: number;          // centro
  y: number;
  orientation: "vertical" | "horizontal"; // qual eixo a porta atravessa
  roomTag: string;
  restricted: boolean;
  gapTiles: number;   // largura do vão em tiles (porta visual = gapTiles × 32 px)
}

/** Porta vertical (atravessa parede vertical).
 *  side: "right" (zona à esquerda, porta no lado direito da zona) ou "left".
 *  gapTiles: largura do vão em tiles (default 2). */
function v(doorId: string, cxTile: number, vGapStartTile: number, side: "right" | "left", roomTag: string, gapTiles = 2.6, restricted = false): DoorConfig {
  const offset = side === "right" ? -WALL_T / 2 : WALL_T / 2;
  return {
    doorId,
    x: cxTile * TILE + offset,
    y: vGapStartTile * TILE + (gapTiles / 2) * TILE,
    orientation: "vertical",
    roomTag,
    restricted,
    gapTiles,
  };
}

/** Porta horizontal (atravessa parede horizontal).
 *  cyTile = y da parede; side "top" = zona abaixo, "bottom" = acima.
 *  gapTiles: largura do vão em tiles (default 2). */
function h(doorId: string, hGapStartTile: number, cyTile: number, side: "top" | "bottom", roomTag: string, gapTiles = 2.6, restricted = false): DoorConfig {
  const offset = side === "top" ? WALL_T / 2 : -WALL_T / 2;
  return {
    doorId,
    x: hGapStartTile * TILE + (gapTiles / 2) * TILE,
    y: cyTile * TILE + offset,
    orientation: "horizontal",
    roomTag,
    restricted,
    gapTiles,
  };
}

export const DOORS: DoorConfig[] = [
  // Diretorias (vão na lateral direita das salas)
  v("door-office_1", 20, 4, "right", "office_1", 2.6, true),
  v("door-office_2", 20, 13, "right", "office_2", 2.6, true),

  // Recepção (lobby y=18, opening pos=4 → tile absoluto 22)
  v("door-lobby", 14, 22, "right", "lobby"),

  // Copa (kitchen y=26, opening pos=4 → tile absoluto 30)
  v("door-kitchen", 14, 30, "right", "kitchen"),

  // Segurança (y=38, opening pos=2 → tile absoluto 40). Reaberta pra que o
  // NPC guarda possa "sair" dessa sala quando alguém tranca sala de reunião.
  v("door-security_room", 14, 40, "right", "security_room"),

  // Reunião XG (vão na lateral esquerda)
  v("door-meeting_xg", 60, 8, "left", "meeting_xg"),

  // Reuniões restantes (M1/G1/G2 — P1, P2, M2 removidas pra ampliar as outras)
  v("door-meeting_m1", 60, 22, "left", "meeting_m1"),
  v("door-meeting_g1", 60, 34, "left", "meeting_g1"),
  v("door-meeting_g2", 60, 47, "left", "meeting_g2"),

  // Lounge: 1 porta horizontal grande no centro (vão de 4 tiles)
  h("door-lounge", 36, 43, "top", "lounge", 5.2),
];

export const DOOR_OPEN_RADIUS_PX = 96;   // 3 tiles
export const DOOR_CLOSE_TIMEOUT_MS = 1200;
