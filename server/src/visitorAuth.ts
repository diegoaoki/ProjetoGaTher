/**
 * Autorizações de visitante que persistem até a meia-noite (horário de
 * Brasília, BRT = UTC-3, sem horário de verão desde 2019).
 *
 * Chaveado pelo userId do visitante (`visitor:<uuid>`), estável enquanto
 * ele mantém o JWT no localStorage (refresh não muda o sub).
 *
 * Persistido em Postgres (app_meta key "visitor_auth", JSON
 * { userId: expiraMs }) — sobrevive a restart/deploy do Railway. Cache
 * em memória pra leitura síncrona; escrita é rara (só quando um host
 * autoriza), então persiste o mapa inteiro a cada autorização.
 */

import { getPool } from "./db/client";

const META_KEY = "visitor_auth";
const authorized = new Map<string, number>(); // userId → expira (ms epoch)
let loaded = false;

/** Próxima 00:00 de Brasília (03:00 UTC) a partir de agora. */
function nextBrtMidnight(): number {
  const now = Date.now();
  const d = new Date(now);
  d.setUTCHours(3, 0, 0, 0); // 00:00 BRT == 03:00 UTC
  if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

function pruneExpired() {
  const now = Date.now();
  for (const [k, v] of authorized) if (v <= now) authorized.delete(k);
}

async function persist() {
  pruneExpired();
  const json = JSON.stringify(Object.fromEntries(authorized));
  try {
    await getPool().query(
      `INSERT INTO app_meta (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [META_KEY, json]
    );
  } catch (e) {
    console.warn("[visitorAuth] persist falhou:", e);
  }
}

/** Carrega o cache do DB (1x no boot). Idempotente. */
export async function loadVisitorAuth() {
  if (loaded) return;
  loaded = true;
  try {
    const r = await getPool().query(`SELECT value FROM app_meta WHERE key = $1`, [META_KEY]);
    const raw = r.rows[0]?.value;
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, number>;
      const now = Date.now();
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "number" && v > now) authorized.set(k, v);
      }
    }
  } catch (e) {
    console.warn("[visitorAuth] load falhou:", e);
  }
}

export function authorizeVisitor(userId: string) {
  if (!userId) return;
  authorized.set(userId, nextBrtMidnight());
  void persist(); // fire-and-forget
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
