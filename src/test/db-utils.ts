// FILE: src/test/db-utils.ts
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { Migrator } from "kysely";
import type { Database } from "../types";
import { tenantMigrationObjects } from "../db/migrations/tenant-migrations-manifest";

const testConnectionString = process.env.DATABASE_URL_TEST;

if (!testConnectionString) {
  throw new Error("DATABASE_URL_TEST is not defined in .env");
}

// Global pool for the admin operations
const adminPool = new Pool({
  connectionString: testConnectionString,
  max: 10,
});

// Admin connection for creating schemas
export const testDbAdmin = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: adminPool }),
});

// Helper to create a fresh schema for a test case
// Returns a Kysely instance scoped to that schema VIA SEARCH PATH
export const createTestUserSchema = async (userId: string) => {
  // ✅ FIX: Match the production naming convention used in auth.service.ts
  // Production uses `user_${userId}` (with dashes preserved).
  // If we don't match this, handlePull/handlePush will try to switch to a schema that doesn't exist.
  const schemaName = `user_${userId}`;
  
  // 1. Create Schema using Admin connection
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(schemaName)}`.execute(testDbAdmin);

  // 2. Run Migrations
  await testDbAdmin.connection().execute(async (conn) => {
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
         if (error instanceof Error) {
            throw error;
         }
         throw new Error(JSON.stringify(error));
       }
     } finally {
       await sql`SET search_path TO public`.execute(conn);
     }
  });

  // 3. Create a ISOLATED Pool for this test with explicit search_path option
  // This is more robust than connection string params.
  // We quote the schema name to safely handle the dashes in the UUID.
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
      // Destroy the scoped pool first to close active connections
      await scopedDb.destroy();
      // Drop the schema using the admin pool
      await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(testDbAdmin);
    }
  };
};

export const closeTestDb = async () => {
  await testDbAdmin.destroy();
};
