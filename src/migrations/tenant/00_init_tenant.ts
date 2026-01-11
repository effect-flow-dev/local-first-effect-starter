// File: src/migrations/tenant/00_init_tenant.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // --- 1. Global Sequence REMOVED (Replaced by HLC Strings) ---

  // --- 2. Identity & Auth ---
  
  // USER
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

  // PASSWORD RESET TOKEN
  await db.schema
    .createTable("password_reset_token")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("expires_at", "timestamp", (c) => c.notNull())
    .execute();

  // EMAIL VERIFICATION TOKEN
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

  // --- 3. Core Entities ---

  // NOTEBOOK
  await db.schema
    .createTable("notebook")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    // ✅ CHANGED: global_version is now text
    .addColumn("global_version", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("notebook_global_version_idx")
    .on("notebook")
    .column("global_version")
    .execute();

  // NOTE
  await db.schema
    .createTable("note")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("content", "jsonb", (c) => c.notNull()) 
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    // ✅ CHANGED: global_version is now text
    .addColumn("global_version", "text", (c) => c.notNull())
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
    .addColumn("user_id", "uuid", (c) => c.notNull().references("user.id").onDelete("cascade"))
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
    .addColumn("user_id", "uuid", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    // ✅ CHANGED: global_version is now text
    .addColumn("global_version", "text", (c) => c.notNull())
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

  // TASK
  await db.schema
    .createTable("task")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (c) => c.notNull().references("user.id").onDelete("cascade"))
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
    // ✅ CHANGED: global_version is now text
    .addColumn("global_version", "text", (c) => c.notNull())
    .addColumn("due_at", "timestamptz")
    .addColumn("assignee_id", "uuid")
    .addColumn("alert_sent_at", "timestamptz")
    .execute();

  await db.schema
    .createIndex("task_global_version_idx")
    .on("task")
    .column("global_version")
    .execute();

  // --- 4. Sync Infrastructure ---

  // TOMBSTONE
  await db.schema
    .createTable("tombstone")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("entity_id", "uuid", (c) => c.notNull())
    .addColumn("entity_type", "text", (c) => c.notNull())
    // ✅ CHANGED: version column is now text
    .addColumn("deleted_at_version", "text", (c) => c.notNull())
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
    .addColumn("user_id", "uuid", (c) => c.notNull().references("user.id").onDelete("cascade"))
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
    .addColumn("user_id", "uuid", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("data", "jsonb", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
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
    .createTable("poke_log")
    .ifNotExists()
    .addColumn("id", "bigserial", (c) => c.primaryKey())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // --- 5. History & Audit ---

  await db.schema
    .createTable("block_history")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("block_id", "uuid", (c) => c.notNull()) 
    .addColumn("note_id", "uuid", (c) => c.notNull().references("note.id").onDelete("cascade"))
    .addColumn("user_id", "uuid", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("timestamp", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("mutation_type", "text", (c) => c.notNull())
    .addColumn("content_snapshot", "jsonb")
    .addColumn("change_delta", "jsonb", (c) => c.notNull())
    .addColumn("was_rejected", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();

  // --- 6. Notifications ---

  await db.schema
    .createTable("push_subscription")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("endpoint", "text", (c) => c.notNull().unique())
    .addColumn("p256dh", "text", (c) => c.notNull())
    .addColumn("auth", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<Database>) {
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
  await db.schema.dropTable("email_verification_token").ifExists().execute();
  await db.schema.dropTable("password_reset_token").ifExists().execute();
  await db.schema.dropTable("user").ifExists().execute();
}
