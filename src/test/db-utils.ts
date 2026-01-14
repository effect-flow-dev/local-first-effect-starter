// File: ./src/test/db-utils.ts
import { Kysely, PostgresDialect, sql, Migrator } from "kysely";
import { Pool } from "pg";
import type { Database } from "../types";
import { tenantMigrationObjects } from "../db/migrations/tenant-migrations-manifest";
import type { UserId } from "../lib/shared/schemas";
// Use the lazy/proxied client which points to the worker-isolated DB
import { centralDb } from "../db/client"; 

/**
 * createTestUserSchema
 * 
 * 1. Creates an isolated schema within the current Worker's database.
 * 2. Runs tenant migrations within that schema.
 * 3. Inserts the test user record.
 * 4. Returns a Kysely instance scoped specifically to this schema.
 */
export const createTestUserSchema = async (userId: string) => {
  const schemaName = `user_${userId.replace(/-/g, "")}`;
  
  // 1. Create Physical Schema (using the shared worker connection)
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(schemaName)}`.execute(centralDb);

  // 2. Provision Tables and Local Admin using a transaction on the worker DB
  await centralDb.connection().execute(async (conn) => {
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

       // Insert the user record so foreign keys work
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
  // We explicitly create a new pool for the test case that defaults to the new schema.
  // We read process.env.DATABASE_URL dynamically to ensure we get the worker-specific URL.
  const workerConnectionString = process.env.DATABASE_URL;
  if (!workerConnectionString) {
      throw new Error("createTestUserSchema: process.env.DATABASE_URL is not set");
  }

  const scopedPool = new Pool({
    connectionString: workerConnectionString,
    max: 5, // Keep low to avoid exhausting the worker DB max connections
    options: `-c search_path="${schemaName}",public` 
  });

  const scopedDb = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: scopedPool }),
  });

  return { 
    db: scopedDb,
    schemaName,
    cleanup: async () => {
      // Destroy the test-specific pool
      await scopedDb.destroy();
      // Drop the schema using the shared worker connection
      await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(centralDb);
    }
  };
};

/**
 * Legacy teardown helper.
 * Since we now use worker-level isolation via setup-worker.ts,
 * we don't need to manually destroy the global admin pool here.
 */
export const closeTestDb = async () => {
  // No-op: Global cleanup is handled by Vitest teardown
};
