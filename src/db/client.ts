// File: src/db/client.ts
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "../types";
import { getTenantConnection } from "./connection-manager";

// Define a minimal interface for Postgres errors
interface PgError {
  code?: string;
}

// Lazy initialization variables
let _pool: Pool | undefined;
let _centralDb: Kysely<Database> | undefined;

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

const initPool = () => {
  if (!_pool) {
    _pool = new Pool({
      connectionString: getConnectionString(),
      connectionTimeoutMillis: 5000,
    });
  }
  return _pool;
};

const initCentralDb = () => {
  if (!_centralDb) {
    const dialect = new PostgresDialect({ pool: initPool() });
    _centralDb = new Kysely<Database>({
      dialect,
      log: (event) => {
        if (event.level === "error") {
          const error = event.error as PgError;
          // Ignore "database already exists" (42P04) during provisioning
          if (error?.code === "42P04") return;
          
          // Ignore "relation does not exist" (42P01) 
          // This happens when AlertWorker scans a tenant whose schema is being created/deleted.
          if (error?.code === "42P01") return;

          console.error("[DB Error]", event.error);
        }
      },
    });
  }
  return _centralDb;
};

// Singleton connection pool for Central DB (and Schema-based tenants)
// Exported as a Proxy to allow lazy initialization (important for testing isolation)
export const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const p = initPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    const value = (p as any)[prop];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return typeof value === 'function' ? value.bind(p) : value;
  }
});

// --- Central Database Instance ---
// Exported as a Proxy so that 'process.env.DATABASE_URL' is read only when the DB is first used.
// This allows test runners to override the URL in 'beforeAll' hooks.
export const centralDb = new Proxy({} as Kysely<Database>, {
  get(_target, prop) {
    const db = initCentralDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    const value = (db as any)[prop];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return typeof value === 'function' ? value.bind(db) : value;
  }
});

/**
 * Gracefully closes the central database connection pool.
 * Used during test teardown to prevent "terminating connection" errors.
 */
export const closeCentralDb = async () => {
  if (_centralDb) {
    await _centralDb.destroy();
    _centralDb = undefined;
    _pool = undefined;
  } else if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
};

/**
 * Tenant Configuration Interface
 */
export interface TenantConfig {
  id: string; // Tenant ID
  tenant_strategy: "schema" | "database";
  database_name: string | null;
  schema_name?: string | null;
}

// Deprecated: Use getTenantDb instead.
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
  const schema = tenant.schema_name || `tenant_${tenant.id}`;
  
  // Use centralDb (which is a Proxy) to create a schema-scoped query builder
  return centralDb.withSchema(schema);
};
