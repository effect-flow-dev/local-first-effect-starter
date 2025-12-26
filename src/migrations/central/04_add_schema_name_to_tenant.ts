// FILE: src/migrations/central/04_add_schema_name_to_tenant.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. Add schema_name column (initially nullable)
  await db.schema
    .alterTable("tenant")
    .addColumn("schema_name", "text")
    .execute();

  // 2. Backfill Schema Name for Schema-Strategy Tenants
  // Logic:
  // - If it's a legacy tenant (created via migration 03), it corresponds to a User's old workspace.
  // - We find the OWNER of this tenant via tenant_membership.
  // - We set schema_name = 'user_' || owner_user_id.
  
  // Note: We use raw SQL for the update with join as Kysely's updateTable with from/join varies by dialect
  await sql`
    UPDATE tenant
    SET schema_name = 'user_' || tm.user_id
    FROM tenant_membership tm
    WHERE tenant.id = tm.tenant_id
      AND tm.role = 'OWNER'
      AND tenant.tenant_strategy = 'schema'
      AND tenant.schema_name IS NULL
  `.execute(db);

  // 3. For any remaining schema-strategy tenants (if any new ones were created without owners),
  // default to 'tenant_' || id. This is the new convention moving forward.
  await sql`
    UPDATE tenant
    SET schema_name = 'tenant_' || id
    WHERE tenant_strategy = 'schema'
      AND schema_name IS NULL
  `.execute(db);

  // 4. (Optional) We don't enforce NOT NULL globally because 'database' strategy might not use it,
  // but good practice to have it populated.
}

export async function down(db: Kysely<Database>) {
  await db.schema.alterTable("tenant").dropColumn("schema_name").execute();
}
