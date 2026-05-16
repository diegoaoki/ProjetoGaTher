/**
 * Autorizações de visitante que persistem até a meia-noite (horário de
 * Brasília, BRT = UTC-3, sem horário de verão desde 2019).
 *
 * Chaveado pelo userId do visitante (`visitor:<uuid>`), que é estável
 * enquanto ele mantém o JWT no localStorage (refresh não muda o sub).
 * Em memória do processo — reinício do server (deploy Railway) limpa,
 * aceitável (o visitante é re-autorizado uma vez).
 */

const authorized = new Map<string, number>(); // userId → expira (ms epoch)

/** Próxima 00:00 de Brasília (03:00 UTC) a partir de agora. */
function nextBrtMidnight(): number {
  const now = Date.now();
  const d = new Date(now);
  d.setUTCHours(3, 0, 0, 0); // 00:00 BRT == 03:00 UTC
  if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

export function authorizeVisitor(userId: string) {
  if (userId) authorized.set(userId, nextBrtMidnight());
}

export function isVisitorAuthorized(userId: string): boolean {
  const exp = authorized.get(userId);
  if (!exp) return false;
  if (exp <= Date.now()) {
    authorized.delete(userId);
    return false;
  }
  return true;
}
