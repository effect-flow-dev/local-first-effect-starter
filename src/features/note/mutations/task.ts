// File: src/features/note/mutations/task.ts
import { Effect } from "effect";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError, VersionConflictError } from "../Errors";
import { logBlockHistory } from "../history.utils";
import { updateTaskInContent } from "../utils/content-traversal";
import type { UpdateTaskArgsSchema } from "../note.schemas";
import type { UserId, BlockId } from "../../../lib/shared/schemas";

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

/**
 * Shared helper to sync the denormalized task table.
 */
export const _syncTaskTable = (
    db: Kysely<Database> | Transaction<Database>,
    blockId: BlockId,
    updates: { is_complete?: boolean; due_at?: string | null },
    globalVersion: string
) => Effect.gen(function* () {
    const updatePayload: Record<string, unknown> = {
        global_version: globalVersion,
        updated_at: sql`now()`
    };

    if (updates.is_complete !== undefined) {
        updatePayload.is_complete = updates.is_complete;
    }

    if (updates.due_at !== undefined) {
        updatePayload.due_at = updates.due_at;
        updatePayload.alert_sent_at = null;
    }

    yield* Effect.tryPromise({
        try: () => db.updateTable("task")
            .set(updatePayload)
            .where("source_block_id", "=", blockId)
            .execute(),
        catch: (cause) => new NoteDatabaseError({ cause })
    });
});

export const handleUpdateTask = (
  db: Kysely<Database> | Transaction<Database>,
  args: typeof UpdateTaskArgsSchema.Type,
  userId: UserId,
  globalVersion: string 
) =>
  Effect.gen(function* () {
    const deviceTime = args.deviceTimestamp || new Date();
    
    yield* Effect.logInfo(`[handleUpdateTask] Task: ${args.blockId}, HLC: ${globalVersion}`);

    const blockRow = yield* Effect.tryPromise({
      try: () => db.selectFrom("block").select(["note_id", "version"]).where("id", "=", args.blockId).executeTakeFirst(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    if (!blockRow) return;

    // Log History First
    yield* logBlockHistory(db, {
        blockId: args.blockId,
        noteId: blockRow.note_id!,
        userId: userId,
        mutationType: "updateTask",
        args: args,
        hlcTimestamp: globalVersion,
        deviceTimestamp: deviceTime
    });

    // Version Check
    const currentVersion = blockRow?.version ?? 1;
    if (args.version !== currentVersion) {
        // Linear History: Fail immediately without mutating history
        return yield* Effect.fail(new VersionConflictError({
            blockId: args.blockId,
            expectedVersion: currentVersion,
            actualVersion: args.version
        }));
    }

    // 1. Update Note Content JSON
    if (blockRow?.note_id) {
      const noteRow = yield* Effect.tryPromise({
        try: () => db.selectFrom("note").select(["id", "content"]).where("id", "=", blockRow.note_id!).executeTakeFirst(),
        catch: (cause) => new NoteDatabaseError({ cause }),
      });

      if (noteRow && noteRow.content) {
        const content = JSON.parse(typeof noteRow.content === "string" ? noteRow.content : JSON.stringify(noteRow.content)) as ContentNode;
        if (updateTaskInContent(content, args.blockId, args.isComplete)) {
          yield* Effect.tryPromise({
            try: () => db.updateTable("note").set({
                  content: content as unknown, 
                  version: sql<number>`version + 1`,
                  updated_at: sql<Date>`now()`,
                  global_version: globalVersion, 
                }).where("id", "=", noteRow.id).execute(),
            catch: (cause) => new NoteDatabaseError({ cause }),
          });
        }
      }
    }

    // 2. Update denormalized Task table
    yield* _syncTaskTable(db, args.blockId, { is_complete: args.isComplete }, globalVersion);

    // 3. Update individual Block record
    yield* Effect.tryPromise({
      try: () => db.updateTable("block").set({
            fields: sql`fields || ${JSON.stringify({ is_complete: args.isComplete, status: args.isComplete ? "done" : "todo" })}::jsonb`,
            version: sql<number>`version + 1`, 
            updated_at: sql<Date>`now()`,
            global_version: globalVersion,
          }).where("id", "=", args.blockId).execute(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });
  });
