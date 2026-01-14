// File: ./src/test/worker-db-setup.ts
import { Pool } from "pg";
// Note: Kysely/Migrator are no longer needed here as we clone the migrated template.
import { TEMPLATE_DB_NAME } from "./global-setup";

/**
 * Helper to construct a connection string for a specific database name
 * based on the test environment configuration.
 */
function getConnectionString(dbName: string = "postgres") {
  const base = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL_TEST (or LOCAL/default) must be set in .env to run tests.");
  }
  
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/**
 * Provisions a fresh, isolated database for a specific Vitest worker.
 * OPTIMIZED: Uses `TEMPLATE life_io_test_template` for instant provisioning.
 * 
 * @param workerId The unique ID of the Vitest worker (process.env.VITEST_WORKER_ID)
 * @returns The connection string for the new worker database.
 */
export async function setupWorkerDb(workerId: number | string): Promise<string> {
  const id = workerId ?? "main";
  const dbName = `life_io_test_${id}`;
  const adminUrl = getConnectionString("postgres");

  const adminPool = new Pool({ 
    connectionString: adminUrl, 
    max: 1,
    connectionTimeoutMillis: 5000 
  });

  try {
    // 1. Cleanup potential stale DB
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    
    // 2. Create new DB by cloning the Template
    // This copies the schema and data (migrations) instantly.
    await adminPool.query(`CREATE DATABASE "${dbName}" TEMPLATE "${TEMPLATE_DB_NAME}"`);
    
  } catch (e) {
    console.error(`[WorkerSetup] Failed to clone database ${dbName} from template`, e);
    throw e;
  } finally {
    await adminPool.end();
  }

  // Return the connection string for the newly created worker DB
  return getConnectionString(dbName);
}

/**
 * Destroys the worker-specific database.
 * Should be called in the 'afterAll' hook of the test setup file.
 */
export async function teardownWorkerDb(workerId: number | string) {
  const id = workerId ?? "main";
  const dbName = `life_io_test_${id}`;
  const adminUrl = getConnectionString("postgres");
  
  const adminPool = new Pool({ 
    connectionString: adminUrl, 
    max: 1 
  });

  try {
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } catch (e) {
    console.error(`[WorkerSetup] Failed to teardown database ${dbName}`, e);
  } finally {
    await adminPool.end();
  }
}
