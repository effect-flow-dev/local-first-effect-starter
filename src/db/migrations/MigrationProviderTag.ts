// lib/server/migrations/MigrationProviderTag.ts
import { Context, Effect } from "effect";
import type { Migration } from "kysely";

/**
 * An Effect-native wrapper for Kysely's MigrationProvider.
 * The `getMigrations` method returns an Effect instead of a Promise.
 */
export interface EffectMigrationProvider {
  readonly getMigrations: Effect.Effect<Record<string, Migration>>;
}

/**
 * The service Tag for our central migration provider.
 */
export class CentralMigrationProvider extends Context.Tag(
  "CentralMigrationProvider",
)<CentralMigrationProvider, EffectMigrationProvider>() {}
