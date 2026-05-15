/**
 * Catálogo de portas funcionais do mapa.
 * Coords (em pixels, centro da porta) calculadas a partir dos openings
 * definidos em `client/src/OfficeLayout.ts`. Mantenha em sync.
 */

const TILE = 32;

export interface DoorConfig {
  doorId: string;
  x: number;          // centro
  y: number;
  orientation: "vertical" | "horizontal"; // qual eixo a porta atravessa
  roomTag: string;
  restricted: boolean;
}

/** Helper: porta vertical (parede vertical, vão horizontal de 2 tiles).
 *  Center y é o meio do vão (2 tiles de altura). */
function v(doorId: string, cxTile: number, vGapStartTile: number, roomTag: string, restricted = false): DoorConfig {
  return {
    doorId,
    x: cxTile * TILE,                       // centro horizontal (parede)
    y: (vGapStartTile + 1) * TILE,           // centro do vão (2 tiles)
    orientation: "vertical",
    roomTag,
    restricted,
  };
}

export const DOORS: DoorConfig[] = [
  // Diretorias (vão na lateral direita das salas)
  v("door-office_1", 20, 4, "office_1", true),
  v("door-office_2", 20, 13, "office_2", true),

  // Reunião XG (vão na lateral esquerda)
  v("door-meeting_xg", 60, 5, "meeting_xg"),

  // Segurança (vão lateral direita)
  v("door-security", 14, 40, "security_room", true),

  // Reuniões P (vão lateral esquerda, pos 2)
  v("door-meeting_p1", 60, 13, "meeting_p1"),
  v("door-meeting_p2", 60, 18, "meeting_p2"),
  v("door-meeting_p3", 60, 23, "meeting_p3"),
  v("door-meeting_p4", 60, 28, "meeting_p4"),

  // Reuniões M
  v("door-meeting_m1", 60, 33, "meeting_m1"),
  v("door-meeting_m2", 60, 39, "meeting_m2"),

  // Reuniões G
  v("door-meeting_g1", 60, 45, "meeting_g1"),
  v("door-meeting_g2", 60, 51, "meeting_g2"),
];

export const DOOR_OPEN_RADIUS_PX = 96;   // 3 tiles
export const DOOR_CLOSE_TIMEOUT_MS = 3000;
