/**
 * Presença online — Set global de userIds atualmente conectados na OfficeRoom.
 *
 * Vive fora do Room (módulo) porque o Express (GET /users) precisa ler isso,
 * e os Rooms do Colyseus não são acessíveis diretamente da camada HTTP.
 * A OfficeRoom é a única que escreve aqui (onJoin/onLeave).
 */

const onlineUserIds = new Set<string>();

export function markOnline(userId: string) {
  if (userId) onlineUserIds.add(userId);
}

export function markOffline(userId: string) {
  if (userId) onlineUserIds.delete(userId);
}

export function isUserOnline(userId: string): boolean {
  return onlineUserIds.has(userId);
}
