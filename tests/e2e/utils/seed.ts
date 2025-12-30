// FILE: tests/e2e/utils/seed.ts
import { Kysely, PostgresDialect, sql, Migrator } from "kysely";
import { Pool } from "pg";
import { Argon2id } from "oslo/password";
import { randomUUID } from "node:crypto";
import type { Database } from "../../../src/types";
import type { UserId } from "../../../src/types/generated/central/public/User";
import type { ConsultancyId } from "../../../src/types/generated/central/public/Consultancy";
import type { TenantId } from "../../../src/types/generated/central/public/Tenant";
import { tenantMigrationObjects } from "../../../src/db/migrations/tenant-migrations-manifest";

const connectionString =
  process.env.DATABASE_URL_TEST ||
  process.env.DATABASE_URL_LOCAL ||
  process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("No database connection string found.");
}

const pool = new Pool({
  connectionString,
});

const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

async function provisionSchema(tenantId: string) {
    const schemaName = `tenant_${tenantId.replace(/-/g, "")}`;

    // 1. Create Schema
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(schemaName)}`.execute(db);

    // 2. Run Migrations
    await db.connection().execute(async (conn) => {
      try {
          await sql`SET search_path TO ${sql.ref(schemaName)}, public`.execute(conn);

          const migrator = new Migrator({
              db: conn,
              provider: {
                  getMigrations: () => Promise.resolve(tenantMigrationObjects),
              },
              migrationTableSchema: schemaName,
          });

          const { error } = await migrator.migrateToLatest();

          if (error) {
              console.error("Migration failed:", error);
              // ✅ FIX: Throw a proper Error object instead of unknown
              throw new Error(`Migration failed: ${JSON.stringify(error)}`);
          }
      } finally {
          await sql`SET search_path TO public`.execute(conn);
      }
    });

    return schemaName;
}

export const createVerifiedUser = async () => {
  const email = `e2e-${randomUUID()}@test.com`;
  const password = "Password123!";
  const userId = randomUUID() as UserId;
  const consultancyId = randomUUID() as ConsultancyId;
  const tenantId = randomUUID() as TenantId;

  const subdomain = `test-e2e-${userId.slice(0,8)}`;

  const argon2id = new Argon2id();
  const hashedPassword = await argon2id.hash(password);

  // ✅ FIX: Provision Schema FIRST.
  const schemaName = await provisionSchema(tenantId);

  await db.transaction().execute(async (trx) => {
      await trx.insertInto("consultancy").values({ id: consultancyId, name: "E2E Corp", created_at: new Date() }).execute();
      
      await trx.insertInto("tenant").values({
          id: tenantId,
          consultancy_id: consultancyId,
          name: "E2E Workspace",
          subdomain: subdomain,
          tenant_strategy: "schema",
          schema_name: schemaName,
          created_at: new Date()
      }).execute();

      await trx.insertInto("user").values({
          id: userId,
          email,
          password_hash: hashedPassword,
          email_verified: true,
          permissions: [],
          created_at: new Date(),
          avatar_url: null
      }).execute();

      await trx.insertInto("tenant_membership").values({
          user_id: userId,
          tenant_id: tenantId,
          role: "OWNER",
          joined_at: new Date()
      }).execute();
  });

  return { email, password, userId, tenantId, subdomain };
};

export const createMultiTenantUser = async () => {
  const email = `mt-e2e-${randomUUID()}@test.com`;
  const password = "Password123!";
  const userId = randomUUID() as UserId;
  const consultancyId = randomUUID() as ConsultancyId;

  const argon2id = new Argon2id();
  const hashedPassword = await argon2id.hash(password);

  // IDs
  const siteAId = randomUUID() as TenantId;
  const siteBId = randomUUID() as TenantId;
  const siteCId = randomUUID() as TenantId;

  const subA = `site-a-${randomUUID().slice(0, 6)}`;
  const subB = `site-b-${randomUUID().slice(0, 6)}`;
  const subC = `site-c-${randomUUID().slice(0, 6)}`;

  // ✅ FIX: Provision Schemas FIRST
  const schemaA = await provisionSchema(siteAId);
  const schemaB = await provisionSchema(siteBId);
  const schemaC = await provisionSchema(siteCId);

  await db.transaction().execute(async (trx) => {
      // 1. User & Consultancy
      await trx.insertInto("consultancy").values({ id: consultancyId, name: "MultiTenant Corp", created_at: new Date() }).execute();
      await trx.insertInto("user").values({
          id: userId,
          email,
          password_hash: hashedPassword,
          email_verified: true,
          permissions: [],
          created_at: new Date(),
          avatar_url: null
      }).execute();

      // 2. Site A (Member)
      await trx.insertInto("tenant").values({
          id: siteAId,
          consultancy_id: consultancyId,
          name: "Site A",
          subdomain: subA,
          tenant_strategy: "schema",
          schema_name: schemaA,
          created_at: new Date()
      }).execute();
      
      await trx.insertInto("tenant_membership").values({ user_id: userId, tenant_id: siteAId, role: "OWNER", joined_at: new Date() }).execute();

      // 3. Site B (Member)
      await trx.insertInto("tenant").values({
          id: siteBId,
          consultancy_id: consultancyId,
          name: "Site B",
          subdomain: subB,
          tenant_strategy: "schema",
          schema_name: schemaB,
          created_at: new Date()
      }).execute();
      
      await trx.insertInto("tenant_membership").values({ user_id: userId, tenant_id: siteBId, role: "MEMBER", joined_at: new Date() }).execute();

      // 4. Site C (Non-Member)
      await trx.insertInto("tenant").values({
          id: siteCId,
          consultancy_id: consultancyId,
          name: "Site C",
          subdomain: subC,
          tenant_strategy: "schema",
          schema_name: schemaC,
          created_at: new Date()
      }).execute();
  });

  return {
      email,
      password,
      userId,
      sites: {
          a: { id: siteAId, subdomain: subA },
          b: { id: siteBId, subdomain: subB },
          c: { id: siteCId, subdomain: subC }
      }
  };
};

export const cleanupUser = async (userId: string) => {
  if (!userId) return;

  const memberships = await db
    .withSchema("public")
    .selectFrom("tenant_membership")
    .select("tenant_id")
    .where("user_id", "=", userId as UserId) // ✅ FIX: Cast string to UserId
    .execute();

  await db.withSchema("public").deleteFrom("user").where("id", "=", userId as UserId).execute();

  for (const m of memberships) {

      const tenantId = m.tenant_id;
      const schemaName = `tenant_${tenantId.replace(/-/g, "")}`;

      try {
          await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(db);
      } catch (e) {
          console.warn(`Cleanup failed for ${schemaName}`, e);
      }

      await db.deleteFrom("tenant").where("id", "=", tenantId).execute();
  }
};
