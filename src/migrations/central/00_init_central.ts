// FILE: src/migrations/central/00_init_central.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. User Table
  // (Combined from original init + removal of columns moved to tenant in pivot)
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

  // 2. Consultancy Table (Added in 03)
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

  // 3. Tenant Table (Added in 03, Updated in 04)
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
    .addColumn("schema_name", "text") // Added in 04
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // 3b. Add Tenant Subdomain Constraint (From 02, applied to tenant)
  await sql`
    ALTER TABLE "tenant"
    ADD CONSTRAINT check_subdomain_format
    CHECK (subdomain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
  `.execute(db);

  // 4. Tenant Membership Table (Added in 03)
  await db.schema
    .createTable("tenant_membership")
    .ifNotExists()
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("tenant_id", "uuid", (c) =>
      c.notNull().references("tenant.id").onDelete("cascade"),
    )
    .addColumn("role", "text", (c) => c.notNull())
    .addColumn("joined_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("tenant_membership_pkey", ["user_id", "tenant_id"])
    .execute();

  // 5. Password Reset Token Table
  await db.schema
    .createTable("password_reset_token")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("expires_at", "timestamp", (c) => c.notNull())
    .execute();

  // 6. Email Verification Token Table
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
}

export async function down(db: Kysely<Database>) {
  // Drop in reverse order of dependencies
  await db.schema.dropTable("email_verification_token").ifExists().execute();
  await db.schema.dropTable("password_reset_token").ifExists().execute();
  await db.schema.dropTable("tenant_membership").ifExists().execute();
  await db.schema.dropTable("tenant").ifExists().execute();
  await db.schema.dropTable("consultancy").ifExists().execute();
  await db.schema.dropTable("user").ifExists().execute();
}
