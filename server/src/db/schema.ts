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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
