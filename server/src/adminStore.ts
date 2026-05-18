/**
 * Admins "extras" (promovidos pela UI), além dos definidos por env
 * ADMIN_EMAILS. Persistido em Postgres (app_meta key "extra_admins",
 * JSON array de emails minúsculos) — sobrevive a restart/deploy.
 * Cache em memória pra leitura síncrona (isAdminEmail é sync e usado
 * no requireAdmin / login / /auth/me). Escrita é rara (promover/
 * remover), então persiste o set inteiro a cada mudança.
 *
 * Admins de env NÃO ficam aqui (são sempre admin e não dá pra
 * "remover" pela UI — voltariam no próximo boot).
 */

import { getPool } from "./db/client";

const META_KEY = "extra_admins";
const extra = new Set<string>(); // emails lowercased
let loaded = false;

function norm(email: string | undefined | null): string {
  return (email || "").toLowerCase().trim();
}

/** Carrega o cache do DB (1x no boot). Idempotente. */
export async function loadAdmins(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const r = await getPool().query(`SELECT value FROM app_meta WHERE key = $1`, [META_KEY]);
    const raw = r.rows[0]?.value;
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const e of arr) if (typeof e === "string") extra.add(norm(e));
      }
    }
    console.log(`[adminStore] ${extra.size} admin(s) extra carregado(s)`);
  } catch (e) {
    console.warn("[adminStore] load falhou:", e);
  }
}

async function persist(): Promise<void> {
  const json = JSON.stringify([...extra]);
  try {
    await getPool().query(
      `INSERT INTO app_meta (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [META_KEY, json]
    );
  } catch (e) {
    console.warn("[adminStore] persist falhou:", e);
  }
}

/** É admin promovido pela UI? (não conta env — isso é no admin.ts) */
export function isExtraAdmin(email: string | undefined | null): boolean {
  const e = norm(email);
  return e ? extra.has(e) : false;
}

/** Promove (make=true) ou remove (make=false) o email do set extra. */
export async function setExtraAdmin(email: string, make: boolean): Promise<void> {
  const e = norm(email);
  if (!e) return;
  if (make) extra.add(e);
  else extra.delete(e);
  await persist();
}
