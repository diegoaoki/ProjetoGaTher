import { Pool } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

let _pool: Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

/**
 * Cria o pool de conexões e o cliente Drizzle.
 * Lazy: só inicializa na primeira chamada — útil pra testes e pra falhar
 * gracefully se DATABASE_URL não estiver setada em dev.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL não configurada. No Railway, adicione o plugin Postgres. Em dev local, rode Postgres (ex: docker run -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres) e exporte DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres"
    );
  }

  _pool = new Pool({
    connectionString,
    // Railway exige SSL em produção. Em dev local não tem.
    ssl: connectionString.includes("railway.app") || connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : false,
  });

  _db = drizzle(_pool, { schema });
  return _db;
}

export function getPool(): Pool {
  if (!_pool) getDb();
  return _pool!;
}
