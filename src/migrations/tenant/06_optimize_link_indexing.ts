// FILE: src/migrations/tenant/06_optimize_link_indexing.ts
import { Kysely } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. Index for fast Title Resolution (Wikilinks)
  // We use standard B-Tree as titles are text
  await db.schema
    .createIndex("note_title_idx")
    .on("note")
    .column("title")
    .ifNotExists()
    .execute();

  // 2. Index for fast Link Cleanup (by source)
  // Already implicitly covered by PK usually, but good to ensure for the FK lookup
  await db.schema
    .createIndex("link_source_block_idx")
    .on("link")
    .column("source_block_id")
    .ifNotExists()
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropIndex("link_source_block_idx").ifExists().execute();
  await db.schema.dropIndex("note_title_idx").ifExists().execute();
}
