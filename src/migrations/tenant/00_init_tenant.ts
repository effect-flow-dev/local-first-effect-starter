// ==========================================
// 3. FILE: src/migrations/tenant/00_init_tenant.ts
// ==========================================

import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // --- CORE DATA ---

  // 1. Note Table
  await db.schema
    .createTable("note")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // Removed FK to public.user because schemas are isolated
    .addColumn("user_id", "uuid", (c) => c.notNull()) 
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("content", "jsonb", (c) => c.notNull())
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("note_user_id_title_unique", ["user_id", "title"])
    .execute();

  // 2. Tag Table
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

  // 3. NoteTag Join Table
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

  // 4. Block Table
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
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // 5. Link Table (Backlinks)
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

  // 6. Task Table
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
    .execute();

  await db.schema
    .createIndex("task_user_id_idx")
    .on("task")
    .column("user_id")
    .execute();

  // --- REPLICACHE INFRASTRUCTURE ---

  // 7. Replicache Client Group
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

  // 8. Replicache Client
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

  // 9. Client View Record (CVR)
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

  // 10. Change Log
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

  // 11. Poke Log
  await db.schema
    .createTable("poke_log")
    .ifNotExists()
    .addColumn("id", "bigserial", (c) => c.primaryKey())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<Database>) {
  // Drop in reverse dependency order
  await db.schema.dropTable("poke_log").ifExists().execute();
  await db.schema.dropTable("change_log").ifExists().execute();
  await db.schema.dropTable("client_view_record").ifExists().execute();
  await db.schema.dropTable("replicache_client").ifExists().execute();
  await db.schema.dropTable("replicache_client_group").ifExists().execute();
  
  await db.schema.dropTable("task").ifExists().execute();
  await db.schema.dropTable("link").ifExists().execute();
  await db.schema.dropTable("block").ifExists().execute();
  await db.schema.dropTable("note_tag").ifExists().execute();
  await db.schema.dropTable("tag").ifExists().execute();
  await db.schema.dropTable("note").ifExists().execute();
}
