 // FILE: src/features/block/block.sync.ts
    import { Effect } from "effect";
    import { sql, type Transaction } from "kysely";
    import type { Database } from "../../types";
    import type { SyncableEntity } from "../../lib/server/sync/sync.types";
    import type { UserId } from "../../lib/shared/schemas";
    import type { PullResponse, SyncFilter } from "../../lib/shared/replicache-schemas";
    import { BlockDatabaseError } from "./Errors";

    export const blockSyncHandler: SyncableEntity = {
      getPatchOperations: (trx: Transaction<Database>, userId: UserId, sinceVersion: number, filter?: SyncFilter) =>
        Effect.gen(function* () {
          const patch: PullResponse["patch"] = [];

          // 1. Fetch Updated Blocks (Delta Query with Filter)
          let query = trx
            .selectFrom("block")
            .selectAll()
            .where("user_id", "=", userId)
            .where("global_version", ">", String(sinceVersion));

          // Apply "The Lens": Only sync blocks matching the tags
          if (filter?.tags && filter.tags.length > 0) {
            query = query.where("block.tags", "&&", sql<string[]>`${filter.tags}`);
          }

          const changedBlocks = yield* Effect.tryPromise({
            try: () => query.execute(),
            catch: (cause) => new BlockDatabaseError({ cause }),
          });

          for (const block of changedBlocks) {
            patch.push({
              op: "put",
              key: `block/${block.id}`,
              value: {
                _tag: "block",
                id: block.id,
                user_id: block.user_id,
                note_id: block.note_id,
                type: block.type,
                content: block.content,
                fields: block.fields ?? {},
                tags: block.tags,
                links: block.links,
                file_path: block.file_path,
                parent_id: block.parent_id,
                depth: block.depth,
                order: block.order,
                transclusions: block.transclusions,
                version: block.version,
                created_at: block.created_at.toISOString(),
                updated_at: block.updated_at.toISOString(),
                global_version: block.global_version || undefined,
                
                // ✅ NEW: Location Context
                entity_id: block.entity_id ? (block.entity_id) : undefined,
                location_source: block.location_source,
                location_accuracy: block.location_accuracy ?? undefined,
                latitude: block.latitude ?? undefined,
                longitude: block.longitude ?? undefined,
                device_created_at: block.device_created_at ? block.device_created_at.toISOString() : undefined,
              },
            });
          }

          // 2. Fetch Deleted Blocks (Tombstones)
          const deletions = yield* Effect.tryPromise({
            try: () => 
              trx
                .selectFrom("tombstone")
                .select("entity_id")
                .where("entity_type", "=", "block")
                .where("deleted_at_version", ">", String(sinceVersion))
                .execute(),
            catch: (cause) => new BlockDatabaseError({ cause }),
          });

          for (const del of deletions) {
            patch.push({ op: "del", key: `block/${del.entity_id}` });
          }

          return patch;
        }),
    };
