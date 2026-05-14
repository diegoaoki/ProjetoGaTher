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
}

export const DESKS: DeskInfo[] = [
  { id: "desk-1", x: 160, y: 200 },
  { id: "desk-2", x: 320, y: 200 },
  { id: "desk-3", x: 220, y: 480 },
  { id: "desk-4", x: 220, y: 680 },
  { id: "desk-5", x: 600, y: 220 },
  { id: "desk-6", x: 780, y: 220 },
  { id: "desk-7", x: 600, y: 420 },
  { id: "desk-8", x: 780, y: 420 },
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
