import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Schema do Postgres usando Drizzle.
 *
 * Estratégia: tabelas criadas via CREATE TABLE IF NOT EXISTS no boot
 * (ver ./init.ts), sem drizzle-kit migrations. Quando o schema crescer,
 * migra-se pra migrations versionadas.
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 256 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
  })
);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 24 }).notNull(),
  bodyColor: varchar("body_color", { length: 7 }).notNull().default("#4ade80"),
  hairColor: varchar("hair_color", { length: 7 }).notNull().default("#3b2c20"),
  // Etapa 3 (LimeZu): personagem escolhido. NULL = usa hash do userId como fallback.
  characterId: varchar("character_id", { length: 16 }),
  // Avatar modular: JSON {body,hair,outfit,hat}. NULL = sem custom (legado).
  appearance: text("appearance"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Reservas de mesas. desk_id é o identificador estável do layout (ex: "desk-1").
 * display_name e body_color são snapshots — assim conseguimos mostrar "Mesa do
 * Fulano (verde)" mesmo quando o dono está offline, sem JOIN em runtime.
 * O snapshot é atualizado quando o user reserva ou troca aparência.
 */
export const deskReservations = pgTable("desk_reservations", {
  deskId: varchar("desk_id", { length: 32 }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 24 }).notNull(),
  bodyColor: varchar("body_color", { length: 7 }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Mensagens de chat persistidas.
 * - channelType="global": recipientId=NULL, visível por todos
 * - channelType="dm": recipientId=outroUser, visível só pelos dois envolvidos
 * - Sala/proximidade NÃO é persistida (efêmera, vive só no Colyseus)
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelType: varchar("channel_type", { length: 16 }).notNull(),
    recipientId: uuid("recipient_id").references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    globalIdx: index("messages_global_idx").on(table.channelType, table.createdAt),
    dmIdx: index("messages_dm_idx").on(table.senderId, table.recipientId, table.createdAt),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type DeskReservation = typeof deskReservations.$inferSelect;
export type NewDeskReservation = typeof deskReservations.$inferInsert;
/**
 * Reações em mensagens (👍 ❤️ etc).
 * PK composta: cada user só pode reagir com o MESMO emoji uma vez por msg.
 * Toggle: se já existe, DELETE; senão INSERT.
 */
export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: varchar("emoji", { length: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    msgIdx: index("message_reactions_msg_idx").on(table.messageId),
  })
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type NewMessageReaction = typeof messageReactions.$inferInsert;
