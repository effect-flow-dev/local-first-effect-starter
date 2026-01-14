// FILE: src/features/entity/entity.sync.ts
    import { Effect } from "effect";
    import type { Transaction } from "kysely";
    import type { Database } from "../../types";
    import type { SyncableEntity } from "../../lib/server/sync/sync.types";
    import type { UserId } from "../../lib/shared/schemas";
    import type { PullResponse, SyncFilter } from "../../lib/shared/replicache-schemas";
    import { EntityDatabaseError } from "./Errors";

    export const entitySyncHandler: SyncableEntity = {
      getPatchOperations: (trx: Transaction<Database>, _userId: UserId, _sinceVersion: number, _filter?: SyncFilter) =>
        Effect.gen(function* () {
          const patch: PullResponse["patch"] = [];

          // 1. Fetch Entities
          // Note: Entities are typically stable reference data, possibly seeded.
          // They might not have a 'global_version' if they are strictly reference data,
          // but if we want to sync them incrementally, we should use 'updated_at' or rely on Full Syncs.
          // However, for consistency with the sync architecture, we assume they are fetched fresh on startup (sinceVersion 0)
          // or we can add a 'version' column to the entity table later.
          // For now, we simply fetch ALL entities if sinceVersion is 0, or assume they are static.
          
          // To be robust, we fetch all. This is fine for small datasets of locations (rooms, buildings).
          // If the list grows huge, we'd add version tracking to the Entity table.
          
          const entities = yield* Effect.tryPromise({
            try: () => trx.selectFrom("entity").selectAll().execute(),
            catch: (cause) => new EntityDatabaseError({ cause }),
          });

          for (const ent of entities) {
            patch.push({
              op: "put",
              key: `entity/${ent.id}`,
              value: {
                _tag: "entity",
                id: ent.id,
                name: ent.name,
                latitude: ent.latitude,
                longitude: ent.longitude,
                description: ent.description,
                created_at: ent.created_at.toISOString(),
                updated_at: ent.updated_at.toISOString(),
              },
            });
          }
          
          // Note: Entity Deletions are not currently tracked via Tombstones in this iteration.
          // They are assumed to be append-only reference data for now.

          return patch;
        }),
    };
