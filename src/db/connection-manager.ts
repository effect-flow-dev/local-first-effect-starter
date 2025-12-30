// FILE: src/db/connection-manager.ts
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "../types";

// Cache for active tenant database connections
// Key: database_name, Value: Kysely instance
const connectionCache = new Map<string, Kysely<Database>>();

/**
 * Retrieves or creates a Kysely instance for a specific tenant database.
 * 
 * @param dbName The name of the tenant's isolated database.
 */
export const getTenantConnection = (dbName: string): Kysely<Database> => {
  if (connectionCache.has(dbName)) {
    return connectionCache.get(dbName)!;
  }

  const useLocalProxy = process.env.USE_LOCAL_NEON_PROXY === "true";
  const baseUrl = useLocalProxy
    ? process.env.DATABASE_URL_LOCAL
    : process.env.DATABASE_URL;

  if (!baseUrl) {
    throw new Error("Missing DATABASE_URL configuration");
  }

  // Parse the base URL to swap the database name
  const url = new URL(baseUrl);
  // Remove leading slash if present in pathname to get pure db name or replace it
  url.pathname = `/${dbName}`;
  const tenantConnectionString = url.toString();

  // ✅ FIX: Use console.info instead of console.log (no-console)
  console.info(`[ConnectionManager] Creating new pool for DB: ${dbName}`);

  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString: tenantConnectionString,
      connectionTimeoutMillis: 5000,
      // Lower max connections for tenant pools to avoid exhausting server resources
      max: 5, 
      idleTimeoutMillis: 30000,
    }),
  });

  const db = new Kysely<Database>({
    dialect,
    log: (event) => {
      if (event.level === "error") {
        // ✅ FIX: Ignore "relation does not exist" (42P01) errors.
        // These occur frequently during the race condition between Tenant Creation 
        // and Schema Provisioning when the AlertWorker scans.
        const error = event.error as { code?: string };
        if (error?.code === "42P01") return;

        console.error(`[DB Error - ${dbName}]`, event.error);
      }
    },
  });

  connectionCache.set(dbName, db);
  return db;
};

/**
 * Closes all active tenant connections.
 * Should be called on server shutdown.
 */
export const closeAllConnections = async () => {
  // ✅ FIX: Use console.info instead of console.log (no-console)
  console.info(`[ConnectionManager] Closing ${connectionCache.size} tenant connections...`);
  const promises = Array.from(connectionCache.values()).map((db) => db.destroy());
  await Promise.all(promises);
  connectionCache.clear();
};
