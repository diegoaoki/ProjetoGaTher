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
}

/** Porta vertical (atravessa parede vertical). Vão de 2 tiles.
 *  side: "right" (zona à esquerda, porta no lado direito da zona) ou "left".
 *  Centro x = centro da parede (cxTile ± WALL_T/2 conforme o lado). */
function v(doorId: string, cxTile: number, vGapStartTile: number, side: "right" | "left", roomTag: string, restricted = false): DoorConfig {
  const offset = side === "right" ? -WALL_T / 2 : WALL_T / 2;
  return {
    doorId,
    x: cxTile * TILE + offset,
    y: vGapStartTile * TILE + TILE,         // centro de vão de 2 tiles
    orientation: "vertical",
    roomTag,
    restricted,
  };
}

/** Porta horizontal (atravessa parede horizontal). Vão de 2 tiles.
 *  cyTile = y da parede; side "top" = zona abaixo, "bottom" = acima. */
function h(doorId: string, hGapStartTile: number, cyTile: number, side: "top" | "bottom", roomTag: string, restricted = false): DoorConfig {
  const offset = side === "top" ? WALL_T / 2 : -WALL_T / 2;
  return {
    doorId,
    x: hGapStartTile * TILE + TILE,         // centro de vão de 2 tiles
    y: cyTile * TILE + offset,
    orientation: "horizontal",
    roomTag,
    restricted,
  };
}

export const DOORS: DoorConfig[] = [
  // Diretorias (vão na lateral direita das salas)
  v("door-office_1", 20, 4, "right", "office_1", true),
  v("door-office_2", 20, 13, "right", "office_2", true),

  // Recepção (lobby y=18, opening pos=4 → tile absoluto 22)
  v("door-lobby", 14, 22, "right", "lobby"),

  // Copa (kitchen y=26, opening pos=4 → tile absoluto 30)
  v("door-kitchen", 14, 30, "right", "kitchen"),

  // Reunião XG (vão na lateral esquerda)
  v("door-meeting_xg", 60, 5, "left", "meeting_xg"),

  // (Segurança removida — sala vedada, sem porta)

  // Reuniões P (vão lateral esquerda, pos 2)
  v("door-meeting_p1", 60, 13, "left", "meeting_p1"),
  v("door-meeting_p2", 60, 18, "left", "meeting_p2"),
  v("door-meeting_p3", 60, 23, "left", "meeting_p3"),
  v("door-meeting_p4", 60, 28, "left", "meeting_p4"),

  // Reuniões M
  v("door-meeting_m1", 60, 33, "left", "meeting_m1"),
  v("door-meeting_m2", 60, 39, "left", "meeting_m2"),

  // Reuniões G
  v("door-meeting_g1", 60, 45, "left", "meeting_g1"),
  v("door-meeting_g2", 60, 51, "left", "meeting_g2"),

  // Lounge (4 portas horizontais na parede norte, alinhadas com openings)
  h("door-lounge_1", 14, 43, "top", "lounge"),
  h("door-lounge_2", 26, 43, "top", "lounge"),
  h("door-lounge_3", 38, 43, "top", "lounge"),
  h("door-lounge_4", 50, 43, "top", "lounge"),
];

export const DOOR_OPEN_RADIUS_PX = 96;   // 3 tiles
export const DOOR_CLOSE_TIMEOUT_MS = 1200;
