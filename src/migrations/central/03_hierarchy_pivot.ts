// FILE: src/migrations/central/03_hierarchy_pivot.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

// Define a temporary interface for the data shape we are migrating FROM.
// These columns exist in the DB at runtime but might not exist in the 'Database' type definition
// if types were generated after this migration was applied/written.
interface LegacyUser {
  id: string;
  email: string;
  subdomain?: string | null;
  tenant_strategy?: string | null;
  database_name?: string | null;
}

export async function up(db: Kysely<Database>) {
  // 1. Create Consultancy Table
  await db.schema
    .createTable("consultancy")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // 2. Create Tenant Table
  await db.schema
    .createTable("tenant")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("consultancy_id", "uuid", (c) =>
      c.notNull().references("consultancy.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("subdomain", "text", (c) => c.notNull().unique())
    .addColumn("tenant_strategy", "text", (c) => c.notNull().defaultTo("schema"))
    .addColumn("database_name", "text")
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // 3. Create Tenant Membership Table
  await db.schema
    .createTable("tenant_membership")
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

  // 4. Backfill Data: Move User Tenant fields to new Tables
  const users = await db.selectFrom("user").selectAll().execute();

  for (const user of users) {
    // Cast to LegacyUser to safely access the old columns
    const u = user as unknown as LegacyUser;
    
    if (u.subdomain) {
      const consultancyId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();

      // Create Personal Consultancy
      await db
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insertInto("consultancy" as any)
        .values({
          id: consultancyId,
          name: `${u.email}'s Organization`,
        })
        .execute();

      // Create Tenant from User's old config
      await db
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insertInto("tenant" as any)
        .values({
          id: tenantId,
          consultancy_id: consultancyId,
          name: `${u.email}'s Workspace`,
          subdomain: u.subdomain,
          tenant_strategy: u.tenant_strategy || "schema",
          database_name: u.database_name,
        })
        .execute();

      // Link User as OWNER
      await db
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insertInto("tenant_membership" as any)
        .values({
          user_id: u.id,
          tenant_id: tenantId,
          role: "OWNER",
        })
        .execute();
    }
  }

  // 5. Drop old columns from User
  await db.schema.alterTable("user").dropColumn("tenant_strategy").execute();
  await db.schema.alterTable("user").dropColumn("database_name").execute();
  await db.schema.alterTable("user").dropColumn("subdomain").execute();
}

export async function down(db: Kysely<Database>) {
  // 1. Add columns back to user
  await db.schema.alterTable("user").addColumn("tenant_strategy", "text").execute();
  await db.schema.alterTable("user").addColumn("database_name", "text").execute();
  await db.schema.alterTable("user").addColumn("subdomain", "text").execute();

  // 2. Drop new tables
  await db.schema.dropTable("tenant_membership").execute();
  await db.schema.dropTable("tenant").execute();
  await db.schema.dropTable("consultancy").execute();
}
