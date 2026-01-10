import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { Migrator } from "kysely";
import type { Database } from "../types";
import { tenantMigrationObjects } from "../db/migrations/tenant-migrations-manifest";
import type { UserId } from "../lib/shared/schemas";

const testConnectionString = process.env.DATABASE_URL_TEST;

if (!testConnectionString) {
  throw new Error("DATABASE_URL_TEST is not defined in .env");
}

const adminPool = new Pool({
  connectionString: testConnectionString,
  max: 10,
});

export const testDbAdmin = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: adminPool }),
});

/**
 * createTestUserSchema
 * 
 * Refactored for Phase 3:
 * 1. Creates an isolated schema.
 * 2. Runs tenant migrations within that schema.
 * 3. Inserts the test user record DIRECTLY into the tenant's local 'user' table.
 */
export const createTestUserSchema = async (userId: string) => {
  const schemaName = `user_${userId.replace(/-/g, "")}`;
  
  // 1. Create Physical Schema
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(schemaName)}`.execute(testDbAdmin);

  // 2. Provision Tables and Local Admin
  await testDbAdmin.connection().execute(async (conn) => {
     try {
       // Target the new schema for migrations and the user insert
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
         throw error instanceof Error ? error : new Error(JSON.stringify(error));
       }

       // ✅ Phase 3 Fix: The user MUST exist in the local schema for FKs and Auth context
       await conn.insertInto("user")
         .values({
           id: userId as UserId,
           email: `test-${userId}@example.com`,
           password_hash: "mock_hash", 
           email_verified: true,
           permissions: [],
           created_at: new Date(),
         })
         .execute();

     } finally {
       // Reset path for the connection pool health
       await sql`SET search_path TO public`.execute(conn);
     }
  });

  // 3. Create a Scoped Kysely Instance
  const scopedPool = new Pool({
    connectionString: testConnectionString,
    max: 5,
    options: `-c search_path="${schemaName}",public` 
  });

  const scopedDb = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: scopedPool }),
  });

  return { 
    db: scopedDb,
    schemaName,
    cleanup: async () => {
      await scopedDb.destroy();
      await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(testDbAdmin);
    }
  };
};

export const closeTestDb = async () => {
  await testDbAdmin.destroy();
};
