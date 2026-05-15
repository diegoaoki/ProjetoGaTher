/**
 * Catálogo de mesas válidas no escritório.
 * IDs estáveis (não mudam) + posição central da mesa.
 *
 * Tem que ficar em sincronia com `client/src/OfficeLayout.ts`. Se mudar
 * o layout de mesas, atualiza dos dois lados.
 *
 * Distribuição atual:
 *  - desk-1, desk-2: Sala grande (privada)
 *  - desk-3: Sala pequena A (privada)
 *  - desk-4: Sala pequena B (privada)
 *  - desk-5 a desk-8: Open space
 */

export interface DeskInfo {
  id: string;
  x: number;
  y: number;
  /** Se true, só admins (ADMIN_EMAILS) podem reservar. Usado pras diretorias. */
  adminOnly?: boolean;
}

/**
 * Mesas reserváveis do mapa grande (Fase B).
 * Distribuídas nas áreas de trabalho da coluna central:
 *  - desk-1..8: Desenvolvimento (8 mesas, 2 fileiras)
 *  - desk-9..13: Dados (5 mesas)
 *  - desk-14..18: Infra (5 mesas)
 *  - desk-19..23: Financeiro (5 mesas)
 *
 * Coordenadas precisam bater com `client/src/OfficeLayout.ts`.
 */
const TILE = 32;
export const DESKS: DeskInfo[] = [
  // Desenvolvimento — fileira 1 (y=4*32=128), 2 (y=8*32=256)
  { id: "desk-1",  x: 24 * TILE, y: 4 * TILE },
  { id: "desk-2",  x: 30 * TILE, y: 4 * TILE },
  { id: "desk-3",  x: 36 * TILE, y: 4 * TILE },
  { id: "desk-4",  x: 42 * TILE, y: 4 * TILE },
  { id: "desk-5",  x: 24 * TILE, y: 8 * TILE },
  { id: "desk-6",  x: 30 * TILE, y: 8 * TILE },
  { id: "desk-7",  x: 36 * TILE, y: 8 * TILE },
  { id: "desk-8",  x: 42 * TILE, y: 8 * TILE },
  // Dados (y=16)
  { id: "desk-9",  x: 24 * TILE, y: 16 * TILE },
  { id: "desk-10", x: 30 * TILE, y: 16 * TILE },
  { id: "desk-11", x: 36 * TILE, y: 16 * TILE },
  { id: "desk-12", x: 42 * TILE, y: 16 * TILE },
  { id: "desk-13", x: 48 * TILE, y: 16 * TILE },
  // Infra (y=26)
  { id: "desk-14", x: 24 * TILE, y: 26 * TILE },
  { id: "desk-15", x: 30 * TILE, y: 26 * TILE },
  { id: "desk-16", x: 36 * TILE, y: 26 * TILE },
  { id: "desk-17", x: 42 * TILE, y: 26 * TILE },
  { id: "desk-18", x: 48 * TILE, y: 26 * TILE },
  // Financeiro (y=36)
  { id: "desk-19", x: 24 * TILE, y: 36 * TILE },
  { id: "desk-20", x: 30 * TILE, y: 36 * TILE },
  { id: "desk-21", x: 36 * TILE, y: 36 * TILE },
  { id: "desk-22", x: 42 * TILE, y: 36 * TILE },
  { id: "desk-23", x: 48 * TILE, y: 36 * TILE },
  // Diretorias — só admin pode reservar. "Assumir a sala" no nível do user.
  { id: "office_1", x: 8 * TILE, y: 4 * TILE, adminOnly: true },
  { id: "office_2", x: 8 * TILE, y: 13 * TILE, adminOnly: true },
];

const DESK_BY_ID = new Map(DESKS.map((d) => [d.id, d]));

export function getDeskById(deskId: string): DeskInfo | undefined {
  return DESK_BY_ID.get(deskId);
}

/**
 * Posição onde o avatar do dono fica sentado na mesa.
 * 36px abaixo do centro = onde fica a cadeira (sincronizado com o client).
 */
export function getSeatPosition(desk: DeskInfo): { x: number; y: number } {
  return { x: desk.x, y: desk.y + 36 };
}
