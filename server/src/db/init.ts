import { getPool } from "./client";

/**
 * Cria tabelas no boot do server (idempotente).
 *
 * Por que não usar drizzle-kit migrations: o schema é pequeno e estável.
 * CREATE TABLE IF NOT EXISTS roda sempre, é seguro, e não precisa
 * versionar uma pasta /drizzle. Quando o schema crescer (alterações
 * destrutivas, índices condicionais, etc), migra-se pra migrations.
 */
export async function initDb(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(256) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

      CREATE TABLE IF NOT EXISTS profiles (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        display_name VARCHAR(24) NOT NULL,
        body_color VARCHAR(7) NOT NULL DEFAULT '#4ade80',
        hair_color VARCHAR(7) NOT NULL DEFAULT '#3b2c20',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("[db] schema inicializado");
  } finally {
    client.release();
  }
}
