// File: ./src/test/global-setup.ts
import { config } from "dotenv";
import { Pool } from "pg";
import { Kysely, PostgresDialect, Migrator } from "kysely";
import { centralMigrationObjects } from "../db/migrations/central-migrations-manifest";
import type { Database } from "../types";

// ✅ FIX: Explicitly load .env variables for Global Setup
// This is required because globalSetup runs in a context where Vitest's 
// automatic env loading might not have applied yet.
config({ path: ".env" });

export const TEMPLATE_DB_NAME = "life_io_test_template";

function getConnectionString(dbName: string) {
  const base = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL_TEST (or LOCAL/default) must be set in .env to run tests.");
  }
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/**
 * Global Setup (Runs once before all tests)
 * 1. Drops/Creates the Template Database.
 * 2. Runs all Central Migrations on it.
 * 3. Closes connections so it can be used as a template.
 */
export async function setup() {
  // ✅ FIX: Use console.info to satisfy no-console rule (allows info/warn/error/debug)
  console.info("⚡ [GlobalSetup] Preparing Template Database...");
  
  const adminUrl = getConnectionString("postgres");
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 });

  try {
    // 1. Recreate Template DB
    await adminPool.query(`DROP DATABASE IF EXISTS "${TEMPLATE_DB_NAME}" WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE "${TEMPLATE_DB_NAME}"`);
  } catch (e) {
    console.error("[GlobalSetup] Failed to create template DB", e);
    throw e;
  } finally {
    await adminPool.end();
  }

  // 2. Run Migrations on Template
  const templateUrl = getConnectionString(TEMPLATE_DB_NAME);
  const templatePool = new Pool({ connectionString: templateUrl, max: 1 });
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: templatePool }),
  });

  try {
    const migrator = new Migrator({
      db,
      provider: {
        getMigrations: () => Promise.resolve(centralMigrationObjects),
      },
    });

    const { error, results } = await migrator.migrateToLatest();

    if (error) {
      console.error("[GlobalSetup] Migration failed on template DB");
      results?.forEach((r) => {
        if (r.status === "Error") console.error(` - ${r.migrationName}: ${r.status}`);
      });
      
      // ✅ FIX: Properly handle non-Error objects to avoid [object Object] in messages
      if (error instanceof Error) {
        throw error;
      }
      
      // Fallback for unknown error types (strings, objects, etc.)
      const errorMsg = typeof error === 'string' ? error : JSON.stringify(error);
      throw new Error(errorMsg);
    }
  } finally {
    // CRITICAL: Close connection to template so it can be cloned by workers
    await db.destroy();
  }

  // ✅ FIX: Use console.info
  console.info("✅ [GlobalSetup] Template Database Ready.");
}

/**
 * Global Teardown (Runs once after all tests)
 */
export async function teardown() {
  // ✅ FIX: Use console.info
  console.info("🧹 [GlobalTeardown] Cleaning up Template Database...");
  const adminUrl = getConnectionString("postgres");
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 });

  try {
    await adminPool.query(`DROP DATABASE IF EXISTS "${TEMPLATE_DB_NAME}" WITH (FORCE)`);
  } catch (e) {
    console.error("[GlobalTeardown] Failed to drop template DB", e);
  } finally {
    await adminPool.end();
  }
}
