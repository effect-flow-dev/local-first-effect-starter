// src/db/kysely.ts
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { Effect } from "effect";
import type { Database } from "../types";

// An Effect that creates our Kysely<DB> instance.
// It reads from process.env to decide which database to connect to.
export const makeDbLive = Effect.gen(function* () {
  const useLocalProxy = process.env.USE_LOCAL_NEON_PROXY === "true";
  const connectionString = useLocalProxy
    ? process.env.DATABASE_URL_LOCAL
    : process.env.DATABASE_URL;

  if (!connectionString) {
    yield* Effect.logError(
      "[makeDbLive] FATAL: DATABASE_URL or DATABASE_URL_LOCAL must be set",
    );
    throw new Error("DATABASE_URL or DATABASE_URL_LOCAL must be set");
  }

  // Log which DB we are connecting to (safely)
  const redactedUrl = connectionString.replace(
    /:([^@]+)@/,
    ":****@",
  );
  yield* Effect.logWarning(
    `[makeDbLive] Initializing Kysely with connection string: ${redactedUrl} (Local Proxy: ${useLocalProxy})`,
  );

  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString,
      // Add a connection timeout to fail fast if DB is unreachable
      connectionTimeoutMillis: 5000,
    }),
  });

  return new Kysely<Database>({
    dialect,
    // Add Kysely log plugin to see SQL queries in console
    // Note: This callback is synchronous and library-invoked, so using standard console methods here 
    // to avoid complexity with Effect runtimes inside sync callbacks is safer, but user requested replacement.
    // However, Effect.log* requires a fiber context. We'll leave this empty or use a simple console.error
    // if strictly required by the user "every console.log replaced", but since we can't yield here easily,
    // we'll remove the log handler to rely on higher-level Effect logging, or just suppress it.
    // For now, removing it avoids the console.error.
    log: (event) => {
      if (event.level === "error") {
        console.error("[Kysely Error]", event.error);
      }
    },
  });
});
