/**
 * Catálogo de mesas válidas no escritório.
 * IDs estáveis (não mudam) + posição central da mesa.
 *
 * Tem que ficar em sincronia com `client/src/OfficeLayout.ts`. Se mudar
 * o layout de mesas, atualiza dos dois lados.
 *
 * O server usa essa lista pra:
 *  - Rejeitar claim de deskId que não existe
 *  - Saber onde teletransportar/spawnar o dono de uma mesa
 */

export interface DeskInfo {
  id: string;
  x: number;
  y: number;
}

export const DESKS: DeskInfo[] = [
  { id: "desk-1", x: 180, y: 280 },
  { id: "desk-2", x: 310, y: 280 },
  { id: "desk-3", x: 440, y: 280 },
  { id: "desk-4", x: 570, y: 280 },
  { id: "desk-5", x: 180, y: 540 },
  { id: "desk-6", x: 310, y: 540 },
  { id: "desk-7", x: 440, y: 540 },
  { id: "desk-8", x: 570, y: 540 },
];

const DESK_BY_ID = new Map(DESKS.map((d) => [d.id, d]));

export function getDeskById(deskId: string): DeskInfo | undefined {
  return DESK_BY_ID.get(deskId);
}

/**
 * Posição onde o avatar do dono fica sentado na mesa.
 * Pra cima da mesa (a cadeira fica abaixo); então spawno acima do centro.
 * Sincronizado com o offset visual usado no client.
 */
export function getSeatPosition(desk: DeskInfo): { x: number; y: number } {
  return { x: desk.x, y: desk.y + 36 }; // 36px abaixo do centro = onde fica a cadeira
}
