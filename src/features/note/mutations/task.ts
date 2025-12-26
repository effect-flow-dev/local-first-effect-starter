// FILE: src/features/note/mutations/task.ts
import { Effect } from "effect";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError, VersionConflictError } from "../Errors";
import { getNextGlobalVersion } from "../../replicache/versioning";
import { logBlockHistory, markHistoryRejected } from "../history.utils";
import { updateTaskInContent } from "../utils/content-traversal";
import type { UpdateTaskArgsSchema } from "../note.schemas";
import type { UserId } from "../../../lib/shared/schemas";

// Re-defining interface to avoid circular deps with large schema file if simple
interface ContentNode {
  type: string;
  attrs?: {
    blockId?: string;
    version?: number;
    fields?: Record<string, unknown>;
    [key: string]: unknown;
  };
  content?: ContentNode[];
}

export const handleUpdateTask = (
  db: Kysely<Database> | Transaction<Database>,
  args: typeof UpdateTaskArgsSchema.Type,
  userId: UserId, 
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[handleUpdateTask] Updating task ${args.blockId}`);
    const globalVersion = yield* getNextGlobalVersion(db);

    const blockRow = yield* Effect.tryPromise({
      try: () => db.selectFrom("block").select(["note_id", "version"]).where("id", "=", args.blockId).executeTakeFirst(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    if (!blockRow) {
      yield* Effect.logWarning(`[handleUpdateTask] Task/Block ${args.blockId} not found.`);
      return;
    }

    let historyId: string | null = null;
    if (blockRow?.note_id) {
        historyId = yield* logBlockHistory(db, {
            blockId: args.blockId,
            noteId: blockRow.note_id,
            userId: userId,
            mutationType: "updateTask",
            args: args
        });
    }

    const currentVersion = blockRow?.version ?? 1;
    if (args.version !== currentVersion) {
        yield* Effect.logWarning(`[handleUpdateTask] Version Conflict!`);
        if (historyId) yield* markHistoryRejected(db, historyId);
        return yield* Effect.fail(new VersionConflictError({
            blockId: args.blockId,
            expectedVersion: currentVersion,
            actualVersion: args.version
        }));
    }

    if (blockRow?.note_id) {
      const noteRow = yield* Effect.tryPromise({
        try: () => db.selectFrom("note").select(["id", "content"]).where("id", "=", blockRow.note_id!).executeTakeFirst(),
        catch: (cause) => new NoteDatabaseError({ cause }),
      });

      if (noteRow && noteRow.content) {
        const content = JSON.parse(JSON.stringify(noteRow.content)) as ContentNode;
        if (updateTaskInContent(content, args.blockId, args.isComplete)) {
          yield* Effect.tryPromise({
            try: () => db.updateTable("note").set({
                  content: content as unknown, 
                  version: sql<number>`version + 1`,
                  updated_at: sql<Date>`now()`,
                  global_version: String(globalVersion), 
                }).where("id", "=", noteRow.id).execute(),
            catch: (cause) => new NoteDatabaseError({ cause }),
          });
        }
      }
    }

    yield* Effect.tryPromise({
      try: () => db.updateTable("task").set({ 
            is_complete: args.isComplete, 
            updated_at: sql<Date>`now()`,
            global_version: String(globalVersion),
          }).where("source_block_id", "=", args.blockId).execute(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    yield* Effect.tryPromise({
      try: () => db.updateTable("block").set({
            fields: sql`fields || ${JSON.stringify({ is_complete: args.isComplete })}::jsonb`,
            version: sql<number>`version + 1`, 
            updated_at: sql<Date>`now()`,
            global_version: String(globalVersion),
          }).where("id", "=", args.blockId).execute(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });
  });
