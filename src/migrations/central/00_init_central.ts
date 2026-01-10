// FILE: src/migrations/central/00_init_central.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. Consultancy Table
  await db.schema
    .createTable("consultancy")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // 2. Tenant Table (Routing Directory)
  await db.schema
    .createTable("tenant")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("consultancy_id", "uuid", (c) =>
      c.notNull().references("consultancy.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("subdomain", "text", (c) => c.notNull().unique())
    .addColumn("tenant_strategy", "text", (c) =>
      c.notNull().defaultTo("schema"),
    )
    .addColumn("database_name", "text")
    .addColumn("schema_name", "text")
    // Added for potential per-tenant secrets (optional, nullable)
    .addColumn("dedicated_db_secret", "text") 
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Subdomain validation check
  await sql`
    ALTER TABLE "tenant"
    ADD CONSTRAINT check_subdomain_format
    CHECK (subdomain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
  `.execute(db);
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("tenant").ifExists().execute();
  await db.schema.dropTable("consultancy").ifExists().execute();
}
