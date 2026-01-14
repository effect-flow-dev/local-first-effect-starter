// FILE: src/features/entity/entity.sync.ts
import { Effect } from "effect";
import type { Transaction } from "kysely";
import type { Database } from "../../types";
import type { SyncableEntity } from "../../lib/server/sync/sync.types";
import type { UserId } from "../../lib/shared/schemas";
import type { PullResponse, SyncFilter } from "../../lib/shared/replicache-schemas";
import { EntityDatabaseError } from "./Errors";

export const entitySyncHandler: SyncableEntity = {
  // ✅ FIX: Update signature to match interface
  getPatchOperations: (trx: Transaction<Database>, _userId: UserId, _sinceVersion: string | number, _filter?: SyncFilter) =>
    Effect.gen(function* () {
      const patch: PullResponse["patch"] = [];

      // Entities are static reference data for now, so we fetch all.
      // Optimization: Could filter by `updated_at` if we parsed sinceVersion as HLC and extracted timestamp, 
      // but Entities are small and infrequent.
      
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

      return patch;
    }),
};
