// lib/server/migrations/EmbeddedCentralMigrationProvider.ts
import { Effect, Layer } from "effect";
import { centralMigrationObjects } from "./central-migrations-manifest";
import { CentralMigrationProvider } from "./MigrationProviderTag";

/**
 * A Layer that provides a live implementation of our custom `EffectMigrationProvider`.
 * It uses `Effect.succeed` to wrap the statically imported migration objects,
 * making it integrate cleanly into the Effect ecosystem.
 */
export const CentralMigrationProviderLive = Layer.succeed(
  CentralMigrationProvider,
  CentralMigrationProvider.of({
    getMigrations: Effect.succeed(centralMigrationObjects),
  }),
);
