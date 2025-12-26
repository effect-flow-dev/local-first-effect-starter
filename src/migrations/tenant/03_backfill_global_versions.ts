// FILE: src/migrations/tenant/03_backfill_global_versions.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. Reset the sequence to start fresh (e.g., 1)
  // This ensures we have a clean, dense range of versions starting now.
  // Warning: If clients hold high cookie values from a previous system, 
  // those clients must be reset (cookie: null) to see these changes.
  await sql`ALTER SEQUENCE global_version_seq RESTART WITH 1`.execute(db);

  // 2. Backfill NOTES
  // Assign a new tick to every note.
  await db
    .updateTable("note")
    .set({ 
      global_version: sql`nextval('global_version_seq')` 
    })
    .execute();

  // 3. Backfill BLOCKS
  await db
    .updateTable("block")
    .set({ 
      global_version: sql`nextval('global_version_seq')` 
    })
    .execute();

  // 4. Backfill TASKS
  await db
    .updateTable("task")
    .set({ 
      global_version: sql`nextval('global_version_seq')` 
    })
    .execute();
}

export async function down(_db: Kysely<Database>) {
  // No-op: We cannot reversibly "un-update" the versions without a backup of the old values.
  // Since this is a data-only migration (no schema changes), a rollback is generally not required 
  // for schema consistency, only for data restoration (which 'down' cannot do safely here).
}
