// FILE: src/features/note/history.utils.ts
import { Effect } from "effect";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../../types";
import type { NoteId, UserId, BlockId } from "../../lib/shared/schemas";
import { NoteDatabaseError } from "./Errors";

// Smart Session Merging Logic
// If the same user updates the same block/note within this window, we update the existing history entry
// instead of creating a new one. This keeps the history clean.
const SESSION_MERGE_WINDOW_MS = 20 * 60 * 1000; // 20 Minutes

export const logBlockHistory = (
  db: Kysely<Database> | Transaction<Database>,
  payload: {
    blockId: BlockId | NoteId;
    noteId: NoteId;
    userId: UserId;
    mutationType: string;
    args: unknown;
    snapshot?: unknown; 
  }
) =>
  Effect.tryPromise({
    try: async () => {
      // 1. Check for a recent entry to merge
      const recentEntry = await db
        .selectFrom("block_history")
        .select(["id", "timestamp"])
        .where("note_id", "=", payload.noteId)
        .where("block_id", "=", payload.blockId)
        .where("user_id", "=", payload.userId)
        .where("mutation_type", "=", payload.mutationType)
        .orderBy("timestamp", "desc")
        .executeTakeFirst();

      const now = new Date();

      if (recentEntry) {
        const timeDiff = now.getTime() - new Date(recentEntry.timestamp).getTime();
        
        // If within window, merge it (Update existing entry)
        if (timeDiff < SESSION_MERGE_WINDOW_MS) {
            
            await db
              .updateTable("block_history")
              .set({
                  change_delta: JSON.stringify(payload.args),
                  content_snapshot: payload.snapshot ? JSON.stringify(payload.snapshot) : null,
                  timestamp: now, // Bump timestamp to keep session alive
              })
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .where("id", "=", recentEntry.id as any)
              .execute();
            
            return recentEntry.id;
        }
      }

      // 2. Otherwise, create new entry
      const result = await db
        .insertInto("block_history")
        .values({
          block_id: payload.blockId,
          note_id: payload.noteId,
          user_id: payload.userId,
          mutation_type: payload.mutationType,
          change_delta: JSON.stringify(payload.args),
          content_snapshot: payload.snapshot ? JSON.stringify(payload.snapshot) : null,
          was_rejected: false, 
          timestamp: now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return result.id;
    },
    catch: (cause) => new NoteDatabaseError({ cause }),
  });

export const markHistoryRejected = (
  db: Kysely<Database> | Transaction<Database>,
  historyId: string
) =>
  Effect.tryPromise({
    try: () =>
      db
        .updateTable("block_history")
        .set({ was_rejected: true })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where("id", "=", historyId as any)
        .execute(),
    catch: (cause) => new NoteDatabaseError({ cause }),
  });
