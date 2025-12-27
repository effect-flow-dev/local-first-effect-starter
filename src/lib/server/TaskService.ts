// FILE: src/lib/server/TaskService.ts
import { Data, Effect } from "effect";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../../types";
import type { UserId } from "../../types/generated/central/public/User";
import type { NewTask } from "../../types/generated/tenant/tenant_template/Task";
import type { NoteId } from "../shared/schemas";

const TASK_REGEX = /^\s*(-\s*)?\[( |x)\]\s+(.*)/i;

export class TaskServiceError extends Data.TaggedError("TaskServiceError")<{
  readonly cause: unknown;
}> {}

export const syncTasksForNote = (
  db: Kysely<Database> | Transaction<Database>, 
  noteId: NoteId, 
  userId: UserId
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(
      `[TaskService] Starting sync for noteId: ${noteId}`,
    );

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
    yield* Effect.logInfo(`[TaskService] Cleared old tasks for note.`);

    const blocks = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("block")
          .select(["id", "content"])
          .where("note_id", "=", noteId)
          //.where("user_id", "=", userId)
          .execute(),
      catch: (cause) => new TaskServiceError({ cause }),
    });
    yield* Effect.logInfo(
      `[TaskService] Found ${blocks.length} blocks to parse for new tasks.`,
    );

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
        });
      }
    }

    if (newTasks.length > 0) {
      yield* Effect.tryPromise({
        try: () => db.insertInto("task").values(newTasks).execute(),
        catch: (cause) => new TaskServiceError({ cause }),
      });
      yield* Effect.logInfo(
        `[TaskService] Inserted ${newTasks.length} new tasks.`,
      );
    }

    yield* Effect.logInfo(
      `[TaskService] Finished task sync for note ${noteId}.`,
    );
  });
