// FILE: src/migrations/tenant/03_add_entities_and_location_context.ts
    import { Kysely, sql } from "kysely";
    import type { Database } from "../../types";

    export async function up(db: Kysely<Database>) {
      // 1. Create Entity Table
      // This table stores fixed assets or locations (e.g., "Server Rack A", "Meeting Room 1")
      // that serve as sources of truth for location data when GPS is unreliable.
      await db.schema
        .createTable("entity")
        .ifNotExists()
        .addColumn("id", "uuid", (c) =>
          c.primaryKey().defaultTo(sql`gen_random_uuid()`),
        )
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("latitude", "double precision", (c) => c.notNull())
        .addColumn("longitude", "double precision", (c) => c.notNull())
        .addColumn("description", "text")
        .addColumn("created_at", "timestamp", (c) =>
          c.notNull().defaultTo(sql`now()`),
        )
        .addColumn("updated_at", "timestamp", (c) =>
          c.notNull().defaultTo(sql`now()`),
        )
        .execute();

      // 2. Alter Block Table
      // Add columns to link a block to an entity and track how the location was derived.
      await db.schema
        .alterTable("block")
        .addColumn("entity_id", "uuid", (c) =>
          c.references("entity.id").onDelete("set null"),
        )
        .addColumn("location_source", "text", (c) =>
          c.notNull().defaultTo("manual"),
        )
        .addColumn("location_accuracy", "double precision")
        .execute();

      // Add constraint to ensure valid location sources
      await sql`
        ALTER TABLE block
        ADD CONSTRAINT check_location_source
        CHECK (location_source IN ('gps', 'manual', 'entity_fixed'))
      `.execute(db);

      // 3. Alter Block History Table
      // Mirror the new columns to the audit trail.
      // Note: We do NOT add a foreign key constraint to `entity_id` in the history table.
      // This ensures the audit log remains intact even if the original Entity record is deleted.
      await db.schema
        .alterTable("block_history")
        .addColumn("entity_id", "uuid")
        .addColumn("location_source", "text")
        .addColumn("location_accuracy", "double precision")
        .execute();
    }

    export async function down(db: Kysely<Database>) {
      // 1. Revert History Table
      await db.schema
        .alterTable("block_history")
        .dropColumn("location_accuracy")
        .dropColumn("location_source")
        .dropColumn("entity_id")
        .execute();

      // 2. Revert Block Table
      // Dropping the column automatically drops the check constraint attached to it in Postgres
      await db.schema
        .alterTable("block")
        .dropColumn("location_accuracy")
        .dropColumn("location_source")
        .dropColumn("entity_id")
        .execute();

      // 3. Drop Entity Table
      await db.schema.dropTable("entity").ifExists().execute();
    }
