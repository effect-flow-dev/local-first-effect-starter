import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. Create Notebook Table
  await db.schema
    .createTable("notebook")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("global_version", "bigint", (c) =>
      c.notNull().defaultTo(sql`nextval('global_version_seq')`),
    )
    .execute();

  // 2. Add Indexes for Notebook
  // Optimized for Delta Sync (get updates since version X)
  await db.schema
    .createIndex("notebook_global_version_idx")
    .on("notebook")
    .column("global_version")
    .execute();

  // Optimized for User lookup
  await db.schema
    .createIndex("notebook_user_id_idx")
    .on("notebook")
    .column("user_id")
    .execute();

  // 3. Update Note Table
  await db.schema
    .alterTable("note")
    .addColumn("notebook_id", "uuid", (c) =>
      c.references("notebook.id").onDelete("set null"),
    )
    .execute();

  // 4. Add Index for Note -> Notebook lookups
  await db.schema
    .createIndex("note_notebook_id_idx")
    .on("note")
    .column("notebook_id")
    .execute();
}

export async function down(db: Kysely<Database>) {
  // Drop index first (good practice, though dropping column usually handles it)
  await db.schema.dropIndex("note_notebook_id_idx").ifExists().execute();

  // Drop column from note
  await db.schema.alterTable("note").dropColumn("notebook_id").execute();

  // Drop notebook table
  await db.schema.dropTable("notebook").ifExists().execute();
}
