// FILE: src/migrations/tenant/07_add_device_time.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. Add Columns
  await db.schema
    .alterTable("note")
    .addColumn("device_created_at", "timestamp")
    .execute();

  await db.schema
    .alterTable("block")
    .addColumn("device_created_at", "timestamp")
    .execute();
    
  // 2. Populate existing rows to avoid nulls (assume server time was correct for old data)
  // ✅ FIX: Use raw SQL to avoid type errors before codegen
  await sql`UPDATE note SET device_created_at = created_at`.execute(db);
  await sql`UPDATE block SET device_created_at = created_at`.execute(db);
}

export async function down(db: Kysely<Database>) {
  await db.schema.alterTable("block").dropColumn("device_created_at").execute();
  await db.schema.alterTable("note").dropColumn("device_created_at").execute();
}
