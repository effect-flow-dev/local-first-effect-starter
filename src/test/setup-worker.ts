// File: ./src/test/setup-worker.ts
import { beforeAll, afterAll } from "vitest";
import { setupWorkerDb, teardownWorkerDb } from "./worker-db-setup";
import { closeCentralDb } from "../db/client";
import { closeAllConnections } from "../db/connection-manager";

/**
 * Worker Setup
 * 
 * This file is added to `setupFiles` in vitest.config.ts.
 * It runs before each test file is executed.
 * 
 * 1. Identifies the current worker ID.
 * 2. Provisions a unique, isolated database (cloned from template).
 * 3. Overrides process.env.DATABASE_URL so the app connects to the isolated DB.
 * 4. Cleans up the database after tests finish.
 */

// Default to '1' if running in single-thread mode (e.g. debugging)
const workerId = process.env.VITEST_WORKER_ID || "1";

beforeAll(async () => {
  // Provision the isolated database
  const connectionString = await setupWorkerDb(workerId);

  // CRITICAL: Override environment variables.
  // When src/db/client.ts is imported by the test, it will read these values
  // and connect to the isolated worker database instead of the main one.
  process.env.DATABASE_URL = connectionString;
  process.env.DATABASE_URL_LOCAL = connectionString;

  // Optional: Log to confirm isolation in verbose mode
  // console.log(`[Worker ${workerId}] Connected to ${connectionString}`);
});

afterAll(async () => {
  // 1. Close application-level connections to the worker DB first.
  // This prevents "terminating connection due to administrator command" errors
  // when we force-drop the database below.
  await closeAllConnections();
  await closeCentralDb();

  // 2. Drop the database to keep the system clean
  await teardownWorkerDb(workerId);
});
