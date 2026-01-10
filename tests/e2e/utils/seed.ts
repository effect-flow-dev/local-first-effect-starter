// FILE: tests/e2e/utils/seed.ts
import { Kysely, PostgresDialect, sql, Migrator } from "kysely";
import { Pool } from "pg";
import { Argon2id } from "oslo/password";
import { randomUUID } from "node:crypto";
import type { Database } from "../../../src/types";
import type { UserId } from "../../../src/lib/shared/schemas"; 
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

    await db.connection().execute(async (conn) => {
      await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(schemaName)}`.execute(conn);

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
              console.error("[Seed] Migration failed:", error);
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
  });

  await db.withSchema(schemaName).insertInto("user").values({
      id: userId,
      email,
      password_hash: hashedPassword,
      email_verified: true,
      permissions: [],
      created_at: new Date(),
      avatar_url: null
  }).execute();

  return { email, password, userId, tenantId, consultancyId, subdomain, schemaName };
};

export const createMultiTenantUser = async () => {
  const email = `mt-e2e-${randomUUID()}@test.com`;
  const password = "Password123!";
  const argon2id = new Argon2id();
  const hashedPassword = await argon2id.hash(password);
  
  const consultancyId = randomUUID() as ConsultancyId;
  await db.insertInto("consultancy").values({ id: consultancyId, name: "MultiTenant Corp", created_at: new Date() }).execute();

  const createSite = async (name: string) => {
      const siteId = randomUUID() as TenantId;
      const sub = `site-${name.toLowerCase()}-${randomUUID().slice(0, 4)}`;
      const schema = await provisionSchema(siteId);
      
      await db.insertInto("tenant").values({
          id: siteId,
          consultancy_id: consultancyId,
          name: `Site ${name}`,
          subdomain: sub,
          tenant_strategy: "schema",
          schema_name: schema,
          created_at: new Date()
      }).execute();

      const uId = randomUUID() as UserId;
      await db.withSchema(schema).insertInto("user").values({
          id: uId,
          email,
          password_hash: hashedPassword,
          email_verified: true,
          permissions: [],
          created_at: new Date(),
          avatar_url: null
      }).execute();

      return { id: siteId, subdomain: sub, userId: uId, schema };
  };

  const siteA = await createSite("A");
  const siteB = await createSite("B");

  const siteCId = randomUUID() as TenantId;
  const subC = `site-c-${randomUUID().slice(0, 4)}`;
  const schemaC = await provisionSchema(siteCId);
  await db.insertInto("tenant").values({
      id: siteCId,
      consultancy_id: consultancyId,
      name: "Site C",
      subdomain: subC,
      tenant_strategy: "schema",
      schema_name: schemaC,
      created_at: new Date()
  }).execute();

  return {
      email,
      password,
      consultancyId,
      userId: siteA.userId, 
      sites: {
          a: siteA,
          b: siteB,
          c: { id: siteCId, subdomain: subC, schema: schemaC }
      }
  };
};

/**
 * ✅ FIX: Isolated Cleanup
 * Removes 'any' casts by using proper string conversion where needed.
 */
export const cleanupUser = async (data: { 
    tenantId?: string, 
    consultancyId?: string, 
    schemaName?: string,
    sites?: Record<string, { id: string, schema: string }>
}) => {
  // 1. Drop Specific Schemas
  if (data.schemaName) {
      await sql`DROP SCHEMA IF EXISTS ${sql.ref(data.schemaName)} CASCADE`.execute(db);
  }
  if (data.sites) {
      for (const site of Object.values(data.sites)) {
          await sql`DROP SCHEMA IF EXISTS ${sql.ref(site.schema)} CASCADE`.execute(db);
      }
  }

  // 2. Delete Central Records for this test only
  if (data.tenantId) {
      await db.deleteFrom("tenant").where("id", "=", data.tenantId as TenantId).execute();
  }
  if (data.sites) {
       const ids = Object.values(data.sites).map(s => s.id as TenantId);
       await db.deleteFrom("tenant").where("id", "in", ids).execute();
  }
  if (data.consultancyId) {
      await db.deleteFrom("consultancy").where("id", "=", data.consultancyId as ConsultancyId).execute();
  }
};
