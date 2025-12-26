import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. Alter block table to ensure version default is 1 (was 0 in init)
  await db.schema
    .alterTable("block")
    .alterColumn("version", (col) => col.setDefault(1))
    .execute();

  // 2. Create block_history table
  await db.schema
    .createTable("block_history")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("block_id", "uuid", (c) => c.notNull())
    .addColumn("note_id", "uuid", (c) => c.notNull())
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("timestamp", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("mutation_type", "text", (c) => c.notNull())
    .addColumn("content_snapshot", "jsonb")
    .addColumn("change_delta", "jsonb", (c) => c.notNull())
    .addColumn("was_rejected", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();

  // 3. Create Indexes for Forensic Retrieval
  await db.schema
    .createIndex("block_history_block_id_idx")
    .on("block_history")
    .column("block_id")
    .execute();

  await db.schema
    .createIndex("block_history_note_id_idx")
    .on("block_history")
    .column("note_id")
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("block_history").ifExists().execute();
  // We do not revert the default value change for 'block.version' to avoid potential data issues
}
