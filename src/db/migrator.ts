// FILE: src/db/migrator.ts
import { Cause, Data, Effect, Exit, Layer } from "effect";
import { Migrator, sql, type Kysely } from "kysely";
import { ObservabilityLive } from "../lib/server/observability";
import type { Database } from "../types";
import { makeDbLive } from "./kysely";
import { CentralMigrationProviderLive } from "./migrations/CentralMigrationProvider";
import { CentralMigrationProvider } from "./migrations/MigrationProviderTag";
import { tenantMigrationObjects } from "./migrations/tenant-migrations-manifest";

// A tagged error for migration failures to improve error handling.
class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly cause: unknown;
}> {}

const runMigrations = (
  direction: "up" | "down",
  db: Kysely<Database>,
  schema?: string,
) =>
  Effect.gen(function* () {
    let migrator: Migrator;

    if (schema) {
      yield* Effect.logInfo(
        { schema, direction },
        "Running TENANT migrations...",
      );

      // 1. Ensure Schema Exists
      yield* Effect.tryPromise({
        try: () => sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(schema)}`.execute(db),
        catch: (cause) => new MigrationError({ cause }),
      });

      // 2. Configure Migrator with Tenant Manifest
      // We create a provider on the fly for the tenant
      migrator = new Migrator({
        db,
        provider: {
          getMigrations: () => Promise.resolve(tenantMigrationObjects),
        },
        migrationTableSchema: schema, // Store migration history IN the tenant schema
      });

      // 3. Set Search Path for this transaction/session logic
      // ✅ FIX: Include public in path
      yield* Effect.tryPromise({
         try: () => sql`SET search_path TO ${sql.ref(schema)}, public`.execute(db),
         catch: (cause) => new MigrationError({ cause }),
      });

    } else {
      yield* Effect.logInfo({ direction }, "Running CENTRAL migrations...");
      const providerService = yield* CentralMigrationProvider;
      
      migrator = new Migrator({
        db,
        provider: {
          getMigrations: () => Effect.runPromise(providerService.getMigrations),
        },
        // Default to public schema
      });
    }

    const { error, results } = yield* Effect.tryPromise({
      try: () =>
        direction === "up"
          ? migrator.migrateToLatest()
          : migrator.migrateDown(),
      catch: (cause) => new MigrationError({ cause }),
    });

    for (const it of results ?? []) {
      const logEffect =
        it.status === "Success" ? Effect.logInfo : Effect.logError;
      yield* logEffect(
        { migrationName: it.migrationName, status: it.status, schema: schema ?? "public" },
        "Migration status",
      );
    }

    if (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "string"
          ? error
          : JSON.stringify(error, null, 2);
      yield* Effect.logError({ error: errorMessage }, "Migration failed");
      return yield* Effect.fail(error);
    }
  });

// ✅ FIX: Explicit return type annotation ensures type safety without 'as' casting
const getArgs = (): { direction: "up" | "down"; schema?: string } => {
  const directionArg = Bun.argv[2];
  const schemaArg = Bun.argv[3]; 

  if (directionArg === "up" || directionArg === "down") {
    return { direction: directionArg, schema: schemaArg };
  }

  console.warn("No direction specified (or invalid). Defaulting to 'up'.");
  return { direction: "up", schema: schemaArg };
};

const { direction, schema } = getArgs();

// This is the core logic of our script.
const programLogic = Effect.gen(function* () {
  const db = yield* makeDbLive;
  // Ensure the database connection is destroyed after migrations run.
  yield* Effect.ensuring(
    runMigrations(direction, db, schema),
    Effect.promise(() => db.destroy()),
  );
});

const programLayer = Layer.merge(
  CentralMigrationProviderLive,
  ObservabilityLive,
);

const runnable = programLogic.pipe(Effect.provide(programLayer));

void Effect.runPromiseExit(runnable).then((exit) => {
  if (Exit.isFailure(exit)) {
    console.error(`❌ Migration via migrator.ts failed ('${direction}' ${schema ? `on ${schema}` : "central"}):`);
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  } else {
    console.info(
      `✅ Migrations via migrator.ts completed successfully ('${direction}' ${schema ? `on ${schema}` : "central"}).`,
    );
    process.exit(0);
  }
});
