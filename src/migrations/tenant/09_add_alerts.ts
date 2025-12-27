// FILE: src/migrations/tenant/09_add_alerts.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. Alter task table to include alert-specific fields
  await db.schema
    .alterTable("task")
    .addColumn("due_at", "timestamptz")
    .addColumn("assignee_id", "uuid")
    .addColumn("alert_sent_at", "timestamptz")
    .execute();

  // 2. Create push_subscription table for Web Push
  await db.schema
    .createTable("push_subscription")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("endpoint", "text", (c) => c.notNull().unique())
    .addColumn("p256dh", "text", (c) => c.notNull())
    .addColumn("auth", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Index for efficient alerting (finding a user's subscriptions)
  await db.schema
    .createIndex("push_subscription_user_id_idx")
    .on("push_subscription")
    .column("user_id")
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("push_subscription").ifExists().execute();

  await db.schema
    .alterTable("task")
    .dropColumn("alert_sent_at")
    .dropColumn("assignee_id")
    .dropColumn("due_at")
    .execute();
}
