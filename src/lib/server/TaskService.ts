// File: src/lib/server/TaskService.ts
import { Data, Effect } from "effect";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../../types";
import type { UserId, NoteId } from "../shared/schemas"; 
import type { NewTask } from "../../types/generated/tenant/tenant_template/Task";

const TASK_REGEX = /^\s*(-\s*)?\[( |x)\]\s+(.*)/i;

export class TaskServiceError extends Data.TaggedError("TaskServiceError")<{
  readonly cause: unknown;
}> {}

/**
 * syncTasksForNote
 * 
 * Extracts tasks from Markdown blocks and syncs them to the 'task' table.
 * ✅ FIXED: Now requires globalVersion (HLC) to satisfy DB constraints.
 */
export const syncTasksForNote = (
  db: Kysely<Database> | Transaction<Database>, 
  noteId: NoteId, 
  userId: UserId,
  globalVersion: string // ✅ NEW
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(
      `[TaskService] Syncing tasks for note: ${noteId} at HLC: ${globalVersion}`,
    );

    // Remove old tasks for this note's blocks
    yield* Effect.tryPromise({
      try: () =>
        db
          .deleteFrom("task")
          .where("source_block_id", "in", (eb) =>
            eb
              .selectFrom("block")
              .select("block.id")
              .where("note_id", "=", noteId),
          )
          .execute(),
      catch: (cause) => new TaskServiceError({ cause }),
    });

    const blocks = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("block")
          .select(["id", "content"])
          .where("note_id", "=", noteId)
          .execute(),
      catch: (cause) => new TaskServiceError({ cause }),
    });

    if (blocks.length === 0) {
      return;
    }

    const newTasks: NewTask[] = [];
    for (const block of blocks) {
      const match = block.content.match(TASK_REGEX);
      if (match) {
        const is_complete = match[2]?.toLowerCase() === "x";
        const content = match[3] ?? "";

        newTasks.push({
          user_id: userId,
          source_block_id: block.id,
          content,
          is_complete,
          // ✅ FIXED: Property 'global_version' added
          global_version: globalVersion,
          updated_at: new Date()
        });
      }
    }

    if (newTasks.length > 0) {
      yield* Effect.tryPromise({
        try: () => db.insertInto("task").values(newTasks).execute(),
        catch: (cause) => new TaskServiceError({ cause }),
      });
    }
  });
