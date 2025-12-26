// FILE: src/features/notebook/notebook.sync.ts
import { Effect } from "effect";
import { type Transaction } from "kysely";
import type { Database } from "../../types";
import type { SyncableEntity } from "../../lib/server/sync/sync.types";
import type { UserId } from "../../lib/shared/schemas";
import type { PullResponse, SyncFilter } from "../../lib/shared/replicache-schemas";
import { NotebookDatabaseError } from "./Errors";

export const notebookSyncHandler: SyncableEntity = {
  getPatchOperations: (
    trx: Transaction<Database>,
    userId: UserId,
    sinceVersion: number,
    _filter?: SyncFilter, // Notebooks are usually global or we could filter by specific IDs
  ) =>
    Effect.gen(function* () {
      const patch: PullResponse["patch"] = [];

      // 1. Fetch Updated Notebooks
      const query = trx
        .selectFrom("notebook")
        .selectAll()
        .where("user_id", "=", userId)
        .where("global_version", ">", String(sinceVersion));

      const changedNotebooks = yield* Effect.tryPromise({
        try: () => query.execute(),
        catch: (cause) => new NotebookDatabaseError({ cause }),
      });

      for (const nb of changedNotebooks) {
        patch.push({
          op: "put",
          key: `notebook/${nb.id}`,
          value: {
            _tag: "notebook",
            // ✅ FIX: With the updated schemas.ts, NotebookId is consistent with DB type.
            id: nb.id,
            user_id: nb.user_id as UserId,
            name: nb.name,
            created_at: nb.created_at.toISOString(),
            global_version: String(nb.global_version),
          },
        });
      }

      // 2. Fetch Deleted Notebooks (Tombstones)
      const deletions = yield* Effect.tryPromise({
        try: () =>
          trx
            .selectFrom("tombstone")
            .select("entity_id")
            .where("entity_type", "=", "notebook")
            .where("deleted_at_version", ">", String(sinceVersion))
            .execute(),
        catch: (cause) => new NotebookDatabaseError({ cause }),
      });

      for (const del of deletions) {
        patch.push({ op: "del", key: `notebook/${del.entity_id}` });
      }

      return patch;
    }),
};
