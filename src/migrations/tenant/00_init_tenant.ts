// FILE: src/migrations/tenant/00_init_tenant.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // --- 1. Global Sequence (Hybrid Logical Clock) ---
  await sql`CREATE SEQUENCE IF NOT EXISTS global_version_seq`.execute(db);

  // --- 2. Core Entities ---

  // NOTEBOOK
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

  await db.schema
    .createIndex("notebook_global_version_idx")
    .on("notebook")
    .column("global_version")
    .execute();

  await db.schema
    .createIndex("notebook_user_id_idx")
    .on("notebook")
    .column("user_id")
    .execute();

  // NOTE
  await db.schema
    .createTable("note")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("content", "jsonb", (c) => c.notNull()) // Legacy full-content blob
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("global_version", "bigint", (c) =>
      c.notNull().defaultTo(sql`nextval('global_version_seq')`),
    )
    .addColumn("notebook_id", "uuid", (c) =>
      c.references("notebook.id").onDelete("set null"),
    )
    .addColumn("device_created_at", "timestamp")
    .addUniqueConstraint("note_user_id_title_unique", ["user_id", "title"])
    .execute();

  await db.schema
    .createIndex("note_global_version_idx")
    .on("note")
    .column("global_version")
    .execute();

  await db.schema
    .createIndex("note_notebook_id_idx")
    .on("note")
    .column("notebook_id")
    .execute();

  await db.schema
    .createIndex("note_title_idx")
    .on("note")
    .column("title")
    .execute();

  // TAG
  await db.schema
    .createTable("tag")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // NOTE_TAG (Join Table)
  await db.schema
    .createTable("note_tag")
    .ifNotExists()
    .addColumn("note_id", "uuid", (c) =>
      c.notNull().references("note.id").onDelete("cascade"),
    )
    .addColumn("tag_id", "uuid", (c) =>
      c.notNull().references("tag.id").onDelete("cascade"),
    )
    .addPrimaryKeyConstraint("note_tag_pkey", ["note_id", "tag_id"])
    .execute();

  // BLOCK
  await db.schema
    .createTable("block")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("content", "text", (c) => c.notNull())
    .addColumn("fields", "jsonb", (c) =>
      c.defaultTo(sql`'{}'::jsonb`).notNull(),
    )
    .addColumn("tags", sql`text[]`, (c) =>
      c.defaultTo(sql`'{}'::text[]`).notNull(),
    )
    .addColumn("links", sql`text[]`, (c) =>
      c.defaultTo(sql`'{}'::text[]`).notNull(),
    )
    .addColumn("transclusions", sql`text[]`, (c) =>
      c.defaultTo(sql`'{}'::text[]`).notNull(),
    )
    .addColumn("file_path", "text", (c) => c.notNull())
    .addColumn("parent_id", "uuid", (c) =>
      c.references("block.id").onDelete("cascade"),
    )
    .addColumn("note_id", "uuid", (c) =>
      c.references("note.id").onDelete("cascade"),
    )
    .addColumn("depth", "integer", (c) => c.notNull())
    .addColumn("order", "integer", (c) => c.notNull())
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("global_version", "bigint", (c) =>
      c.notNull().defaultTo(sql`nextval('global_version_seq')`),
    )
    .addColumn("device_created_at", "timestamp")
    .addColumn("latitude", "double precision")
    .addColumn("longitude", "double precision")
    .execute();

  await db.schema
    .createIndex("block_global_version_idx")
    .on("block")
    .column("global_version")
    .execute();

  // LINK (Backlinks)
  await db.schema
    .createTable("link")
    .ifNotExists()
    .addColumn("source_block_id", "uuid", (c) =>
      c.notNull().references("block.id").onDelete("cascade"),
    )
    .addColumn("target_note_id", "uuid", (c) =>
      c.notNull().references("note.id").onDelete("cascade"),
    )
    .addPrimaryKeyConstraint("link_pkey", [
      "source_block_id",
      "target_note_id",
    ])
    .execute();

  await db.schema
    .createIndex("link_target_note_id_idx")
    .on("link")
    .column("target_note_id")
    .execute();

  await db.schema
    .createIndex("link_source_block_idx")
    .on("link")
    .column("source_block_id")
    .execute();

  // TASK
  await db.schema
    .createTable("task")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("source_block_id", "uuid", (c) =>
      c.notNull().references("block.id").onDelete("cascade").unique(),
    )
    .addColumn("content", "text", (c) => c.notNull())
    .addColumn("is_complete", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("due_date", "timestamp")
    .addColumn("project", "text")
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("global_version", "bigint", (c) =>
      c.notNull().defaultTo(sql`nextval('global_version_seq')`),
    )
    .addColumn("due_at", "timestamptz")
    .addColumn("assignee_id", "uuid")
    .addColumn("alert_sent_at", "timestamptz")
    .execute();

  await db.schema
    .createIndex("task_user_id_idx")
    .on("task")
    .column("user_id")
    .execute();

  await db.schema
    .createIndex("task_global_version_idx")
    .on("task")
    .column("global_version")
    .execute();

  // --- 3. Sync Infrastructure ---

  // TOMBSTONE
  await db.schema
    .createTable("tombstone")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("entity_id", "uuid", (c) => c.notNull())
    .addColumn("entity_type", "text", (c) => c.notNull()) // 'note', 'block', 'task', 'notebook'
    .addColumn("deleted_at_version", "bigint", (c) => c.notNull())
    .addColumn("deleted_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("tombstone_version_idx")
    .on("tombstone")
    .column("deleted_at_version")
    .execute();

  // REPLICACHE TABLES
  await db.schema
    .createTable("replicache_client_group")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("cvr_version", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("replicache_client")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("client_group_id", "text", (c) =>
      c.notNull().references("replicache_client_group.id").onDelete("cascade"),
    )
    .addColumn("last_mutation_id", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("client_view_record")
    .ifNotExists()
    .addColumn("id", "serial", (c) => c.primaryKey())
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("data", "jsonb", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("cvr_user_id_created_at_idx")
    .on("client_view_record")
    .columns(["user_id", "created_at"])
    .execute();

  await db.schema
    .createTable("change_log")
    .ifNotExists()
    .addColumn("id", "bigserial", (c) => c.primaryKey())
    .addColumn("client_group_id", "text", (c) =>
      c.notNull().references("replicache_client_group.id").onDelete("cascade"),
    )
    .addColumn("client_id", "text", (c) =>
      c.notNull().references("replicache_client.id").onDelete("cascade"),
    )
    .addColumn("mutation_id", "integer", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("args", "jsonb", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("change_log_client_group_id_id_idx")
    .on("change_log")
    .columns(["client_group_id", "id"])
    .execute();

  await db.schema
    .createTable("poke_log")
    .ifNotExists()
    .addColumn("id", "bigserial", (c) => c.primaryKey())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // --- 4. History & Audit ---

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

  // --- 5. Notifications ---

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

  await db.schema
    .createIndex("push_subscription_user_id_idx")
    .on("push_subscription")
    .column("user_id")
    .execute();
}

export async function down(db: Kysely<Database>) {
  // Drop in reverse dependency order
  await db.schema.dropTable("push_subscription").ifExists().execute();
  await db.schema.dropTable("block_history").ifExists().execute();
  await db.schema.dropTable("poke_log").ifExists().execute();
  await db.schema.dropTable("change_log").ifExists().execute();
  await db.schema.dropTable("client_view_record").ifExists().execute();
  await db.schema.dropTable("replicache_client").ifExists().execute();
  await db.schema.dropTable("replicache_client_group").ifExists().execute();
  await db.schema.dropTable("tombstone").ifExists().execute();
  await db.schema.dropTable("task").ifExists().execute();
  await db.schema.dropTable("link").ifExists().execute();
  await db.schema.dropTable("block").ifExists().execute();
  await db.schema.dropTable("note_tag").ifExists().execute();
  await db.schema.dropTable("tag").ifExists().execute();
  await db.schema.dropTable("note").ifExists().execute();
  await db.schema.dropTable("notebook").ifExists().execute();
  await sql`DROP SEQUENCE IF EXISTS global_version_seq`.execute(db);
}
