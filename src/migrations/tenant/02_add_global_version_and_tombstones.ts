// FILE: src/migrations/tenant/02_add_global_version_and_tombstones.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. Create Global Sequence
  // This acts as the hybrid logical clock for the tenant.
  // We use a BIGINT sequence to avoid overflow.
  await sql`CREATE SEQUENCE IF NOT EXISTS global_version_seq`.execute(db);

  // 2. Create Tombstone Ledger
  // Used for Delta-Sync deletion detection without calculating differences against a CVR.
  // This explicitly records *what* was destroyed and *when* (global_version).
  await db.schema
    .createTable("tombstone")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("entity_id", "uuid", (c) => c.notNull()) // The ID of the deleted entity
    .addColumn("entity_type", "text", (c) => c.notNull()) // 'note', 'block', 'task'
    .addColumn("deleted_at_version", "bigint", (c) => c.notNull())
    .addColumn("deleted_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Index for fast delta queries: "Give me everything deleted since version X"
  await db.schema
    .createIndex("tombstone_version_idx")
    .on("tombstone")
    .column("deleted_at_version")
    .execute();

  // 3. Schema Alignment: Add global_version to syncable entities
  const tables = ["note", "block", "task"] as const;

  for (const table of tables) {
    // Add column with a default value.
    // This effectively "backfills" existing rows, assigning them a new tick from the clock.
    // This ensures existing data isn't invisible to the new sync logic.
    await db.schema
      .alterTable(table)
      .addColumn("global_version", "bigint", (c) =>
        c.notNull().defaultTo(sql`nextval('global_version_seq')`),
      )
      .execute();

    // Index for fast delta queries: "Give me everything changed since version X"
    await db.schema
      .createIndex(`${table}_global_version_idx`)
      .on(table)
      .column("global_version")
      .execute();
  }
}

export async function down(db: Kysely<Database>) {
  const tables = ["note", "block", "task"] as const;

  for (const table of tables) {
    await db.schema.alterTable(table).dropColumn("global_version").execute();
  }

  await db.schema.dropTable("tombstone").execute();
  await sql`DROP SEQUENCE IF EXISTS global_version_seq`.execute(db);
}


