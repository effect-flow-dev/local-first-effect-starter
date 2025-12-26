// FILE: tests/e2e/utils/seed.ts
    import { Kysely, PostgresDialect, sql, Migrator } from "kysely";
    import { Pool } from "pg";
    import { Argon2id } from "oslo/password";
    import { randomUUID } from "node:crypto";
    import type { Database } from "../../../src/types";
    import type { UserId } from "../../../src/types/generated/public/User";
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
      const userId = randomUUID();
      const consultancyId = randomUUID();
      const tenantId = randomUUID();

      const subdomain = `test-e2e-${userId.slice(0,8)}`;
      const schemaName = `tenant_${tenantId.replace(/-/g, "")}`;

      const argon2id = new Argon2id();
      const hashedPassword = await argon2id.hash(password);

      await db.transaction().execute(async (trx) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await trx.insertInto("consultancy" as any).values({ id: consultancyId, name: "E2E Corp", created_at: new Date() }).execute();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await trx.insertInto("tenant" as any).values({
              id: tenantId,
              consultancy_id: consultancyId,
              name: "E2E Workspace",
              subdomain: subdomain,
              tenant_strategy: "schema",
              schema_name: schemaName,
              created_at: new Date()
          }).execute();

          await trx.insertInto("user").values({
              id: userId as UserId,
              email,
              password_hash: hashedPassword,
              email_verified: true,
              permissions: [],
              created_at: new Date(),
              avatar_url: null
          }).execute();

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await trx.insertInto("tenant_membership" as any).values({
              user_id: userId,
              tenant_id: tenantId,
              role: "OWNER",
              joined_at: new Date()
          }).execute();
      });

      await provisionSchema(tenantId);

      return { email, password, userId, tenantId, subdomain };
    };

    export const createMultiTenantUser = async () => {
      const email = `mt-e2e-${randomUUID()}@test.com`;
      const password = "Password123!";
      const userId = randomUUID();
      const consultancyId = randomUUID();

      const argon2id = new Argon2id();
      const hashedPassword = await argon2id.hash(password);

      // IDs
      const siteAId = randomUUID();
      const siteBId = randomUUID();
      const siteCId = randomUUID();

      const subA = `site-a-${randomUUID().slice(0, 6)}`;
      const subB = `site-b-${randomUUID().slice(0, 6)}`;
      const subC = `site-c-${randomUUID().slice(0, 6)}`;

      await db.transaction().execute(async (trx) => {
          // 1. User & Consultancy
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await trx.insertInto("consultancy" as any).values({ id: consultancyId, name: "MultiTenant Corp", created_at: new Date() }).execute();
          await trx.insertInto("user").values({
              id: userId as UserId,
              email,
              password_hash: hashedPassword,
              email_verified: true,
              permissions: [],
              created_at: new Date(),
              avatar_url: null
          }).execute();

          // 2. Site A (Member)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await trx.insertInto("tenant" as any).values({
              id: siteAId,
              consultancy_id: consultancyId,
              name: "Site A",
              subdomain: subA,
              tenant_strategy: "schema",
              schema_name: `tenant_${siteAId.replace(/-/g, "")}`,
              created_at: new Date()
          }).execute();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await trx.insertInto("tenant_membership" as any).values({ user_id: userId, tenant_id: siteAId, role: "OWNER", joined_at: new Date() }).execute();

          // 3. Site B (Member)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await trx.insertInto("tenant" as any).values({
              id: siteBId,
              consultancy_id: consultancyId,
              name: "Site B",
              subdomain: subB,
              tenant_strategy: "schema",
              schema_name: `tenant_${siteBId.replace(/-/g, "")}`,
              created_at: new Date()
          }).execute();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await trx.insertInto("tenant_membership" as any).values({ user_id: userId, tenant_id: siteBId, role: "MEMBER", joined_at: new Date() }).execute();

          // 4. Site C (Non-Member)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await trx.insertInto("tenant" as any).values({
              id: siteCId,
              consultancy_id: consultancyId,
              name: "Site C",
              subdomain: subC,
              tenant_strategy: "schema",
              schema_name: `tenant_${siteCId.replace(/-/g, "")}`,
              created_at: new Date()
          }).execute();
      });

      // Provision physical schemas for all (so 403 is pure auth, not 404/500)
      await provisionSchema(siteAId);
      await provisionSchema(siteBId);
      await provisionSchema(siteCId);

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .selectFrom("tenant_membership" as any)
        .select("tenant_id")
        .where("user_id", "=", userId)
        .execute();

      await db.withSchema("public").deleteFrom("user").where("id", "=", userId as UserId).execute();

      for (const m of memberships) {

          const mTyped = m as { tenant_id: string };
          const schemaName = `tenant_${mTyped.tenant_id.replace(/-/g, "")}`;

          try {
              await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(db);
          } catch (e) {
              console.warn(`Cleanup failed for ${schemaName}`, e);
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.deleteFrom("tenant" as any).where("id", "=", mTyped.tenant_id).execute();
      }
    };
