// ==========================================
// 2. FILE: src/migrations/central/00_init_central.ts
// ==========================================

import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. User Table
  await db.schema
    .createTable("user")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("email", "text", (c) => c.notNull().unique())
    .addColumn("password_hash", "text", (c) => c.notNull())
    .addColumn("permissions", sql`text[]`, (c) =>
      c.defaultTo(sql`'{}'::text[]`),
    )
    .addColumn("avatar_url", "text")
    .addColumn("email_verified", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // 2. Password Reset Token Table
  await db.schema
    .createTable("password_reset_token")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("expires_at", "timestamp", (c) => c.notNull())
    .execute();

  // 3. Email Verification Token Table
  await db.schema
    .createTable("email_verification_token")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("expires_at", "timestamp", (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("email_verification_token").ifExists().execute();
  await db.schema.dropTable("password_reset_token").ifExists().execute();
  await db.schema.dropTable("user").ifExists().execute();
}
