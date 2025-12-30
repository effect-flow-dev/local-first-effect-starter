// FILE: src/db/client.ts
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "../types";
import { getTenantConnection } from "./connection-manager";

// Define a minimal interface for Postgres errors
interface PgError {
  code?: string;
}

const getConnectionString = () => {
  const useLocalProxy = process.env.USE_LOCAL_NEON_PROXY === "true";
  const connectionString = useLocalProxy
    ? process.env.DATABASE_URL_LOCAL
    : process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "FATAL: DATABASE_URL or DATABASE_URL_LOCAL must be set in environment variables."
    );
  }
  return connectionString;
};

// Singleton connection pool for Central DB (and Schema-based tenants)
export const pool = new Pool({
  connectionString: getConnectionString(),
  connectionTimeoutMillis: 5000,
});

const dialect = new PostgresDialect({ pool });

// --- Central Database Instance ---
export const centralDb = new Kysely<Database>({
  dialect,
  log: (event) => {
    if (event.level === "error") {
      const error = event.error as PgError;
      // Ignore "database already exists" (42P04) during provisioning
      if (error?.code === "42P04") return;
      
      // ✅ FIX: Ignore "relation does not exist" (42P01) 
      // This happens when AlertWorker scans a tenant whose schema is being created/deleted.
      if (error?.code === "42P01") return;

      console.error("[DB Error]", event.error);
    }
  },
});

/**
 * Tenant Configuration Interface
 */
export interface TenantConfig {
  id: string; // Tenant ID
  tenant_strategy: "schema" | "database";
  database_name: string | null;
  schema_name?: string | null; // ✅ Added support for explicit schema naming
}

// Deprecated: Use getTenantDb instead.
// Kept temporarily if any legacy tests rely on it, but internal logic should shift.
export { getUserDb as getTenantDb };

/**
 * Tenant Database Factory
 *
 * Returns the appropriate Kysely instance based on the TENANT'S isolation strategy.
 */
export const getUserDb = (tenant: TenantConfig): Kysely<Database> => {
  // Strategy: Database
  if (tenant.tenant_strategy === "database") {
    if (!tenant.database_name) {
      throw new Error(
        `Tenant ${tenant.id} has 'database' strategy but no database_name set.`,
      );
    }
    return getTenantConnection(tenant.database_name);
  }

  // Strategy: Schema (Default)
  // Uses the explicitly stored schema_name (e.g. "user_123" or "tenant_456")
  // Falls back to "tenant_{id}" if missing.
  const schema = tenant.schema_name || `tenant_${tenant.id}`;
  
  return centralDb.withSchema(schema);
};
