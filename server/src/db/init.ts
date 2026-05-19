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

      -- Migration idempotente: adiciona coluna character_id em profiles existentes
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS character_id VARCHAR(16);
      -- Avatar modular: JSON {body,hair,outfit,hat} (NULL = legado)
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS appearance TEXT;
      -- Foto de perfil (data URL pequeno) p/ o mini-mapa (NULL = sem)
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS photo TEXT;

      CREATE TABLE IF NOT EXISTS desk_reservations (
        desk_id VARCHAR(32) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        display_name VARCHAR(24) NOT NULL,
        body_color VARCHAR(7) NOT NULL,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS desk_reservations_user_idx ON desk_reservations (user_id);
      -- Customização da mesa pelo dono (some com a reserva ao liberar)
      ALTER TABLE desk_reservations ADD COLUMN IF NOT EXISTS desk_tex TEXT;
      ALTER TABLE desk_reservations ADD COLUMN IF NOT EXISTS desk_decor TEXT;

      CREATE TABLE IF NOT EXISTS app_meta (
        key VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_type VARCHAR(16) NOT NULL,
        recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS messages_global_idx ON messages (channel_type, created_at);
      CREATE INDEX IF NOT EXISTS messages_dm_idx ON messages (sender_id, recipient_id, created_at);
      -- Index complementar pra olhar DMs recebidas
      CREATE INDEX IF NOT EXISTS messages_dm_recipient_idx ON messages (recipient_id, sender_id, created_at);

      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji VARCHAR(8) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, user_id, emoji)
      );

      CREATE INDEX IF NOT EXISTS message_reactions_msg_idx ON message_reactions (message_id);
    `);

    // Migration automática: se a versão do layout de mesas mudou, limpa
    // reservas (porque as coordenadas mudaram e as antigas viraram lixo).
    // Bump a string abaixo toda vez que mudar posições/quantidade de mesas.
    const DESK_LAYOUT_VERSION = "2026-05-15-bigmap";
    const meta = await client.query(
      `SELECT value FROM app_meta WHERE key = $1`,
      ["desk_layout_version"]
    );
    const stored = meta.rows[0]?.value;
    if (stored !== DESK_LAYOUT_VERSION) {
      const result = await client.query(`DELETE FROM desk_reservations`);
      await client.query(
        `INSERT INTO app_meta (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        ["desk_layout_version", DESK_LAYOUT_VERSION]
      );
      console.log(
        `[db] layout de mesas mudou (${stored || "vazio"} → ${DESK_LAYOUT_VERSION}). ` +
        `Reservas limpas: ${result.rowCount}`
      );
    }

    console.log("[db] schema inicializado");
  } finally {
    client.release();
  }
}
