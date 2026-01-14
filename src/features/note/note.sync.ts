// FILE: src/features/note/note.sync.ts
import { Effect, Schema } from "effect";
import { TreeFormatter } from "effect/ParseResult";
import { sql, type Transaction } from "kysely";
import type { Database } from "../../types";
import type { SyncableEntity } from "../../lib/server/sync/sync.types";
import type { UserId } from "../../lib/shared/schemas";
import { TiptapDocSchema } from "../../lib/shared/schemas";
import type { PullResponse, SyncFilter } from "../../lib/shared/replicache-schemas";
import { NoteDatabaseError } from "./Errors";

export const noteSyncHandler: SyncableEntity = {
  // ✅ FIX: sinceVersion type updated to string | number
  getPatchOperations: (trx: Transaction<Database>, userId: UserId, sinceVersion: string | number, filter?: SyncFilter) =>
    Effect.gen(function* () {
      const patch: PullResponse["patch"] = [];

      // 1. Fetch Updated Notes (Delta Query with Filter)
      let query = trx
        .selectFrom("note")
        .selectAll()
        .where("user_id", "=", userId)
        // ✅ FIX: Use String() to ensure we compare against the text column in DB.
        // HLC strings like "173...:0001:ID" sort correctly lexicographically against other HLC strings.
        .where("global_version", ">", String(sinceVersion));

      if (filter?.tags && filter.tags.length > 0) {
        query = query.where((eb) =>
          eb.exists(
            eb.selectFrom("block")
              .select("block.id")
              .whereRef("block.note_id", "=", "note.id")
              .where("block.tags", "&&", sql<string[]>`${filter.tags}`)
          )
        );
      }

      const changedNotes = yield* Effect.tryPromise({
        try: () => query.execute(),
        catch: (cause) => new NoteDatabaseError({ cause }),
      });

      for (const note of changedNotes) {
        const decodeResult = Schema.decodeUnknownEither(TiptapDocSchema)(note.content);

        if (decodeResult._tag === "Left") {
          const errorMsg = Effect.runSync(TreeFormatter.formatError(decodeResult.left));
          yield* Effect.logError(`[NoteSync] Decode error note ${note.id}: ${errorMsg}`);
          
          patch.push({
            op: "put",
            key: `note/${note.id}`,
            value: {
              _tag: "note",
              id: note.id,
              user_id: note.user_id,
              title: `${note.title} (Sync Error)`,
              content: { type: "doc", content: [] },
              version: note.version,
              created_at: note.created_at.toISOString(),
              updated_at: note.updated_at.toISOString(),
              global_version: String(note.global_version),
              notebook_id: note.notebook_id,
            },
          });
          continue;
        }

        patch.push({
          op: "put",
          key: `note/${note.id}`,
          value: {
            _tag: "note",
            id: note.id,
            user_id: note.user_id,
            title: note.title,
            content: decodeResult.right,
            version: note.version,
            created_at: note.created_at.toISOString(),
            updated_at: note.updated_at.toISOString(),
            global_version: String(note.global_version),
            notebook_id: note.notebook_id,
          },
        });
      }

      // 2. Fetch Deleted Notes (Tombstones)
      const deletions = yield* Effect.tryPromise({
        try: () => 
          trx
            .selectFrom("tombstone")
            .select("entity_id")
            .where("entity_type", "=", "note")
            .where("deleted_at_version", ">", String(sinceVersion))
            .execute(),
        catch: (cause) => new NoteDatabaseError({ cause }),
      });

      for (const del of deletions) {
        patch.push({ op: "del", key: `note/${del.entity_id}` });
      }

      return patch;
    }),
};
