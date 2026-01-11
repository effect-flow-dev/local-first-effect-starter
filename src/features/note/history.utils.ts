// FILE: src/features/note/history.utils.ts
import { Effect } from "effect";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../../types";
import type { NoteId, UserId, BlockId } from "../../lib/shared/schemas";
import type { BlockHistoryId } from "../../types/generated/tenant/tenant_template/BlockHistory";
import { NoteDatabaseError } from "./Errors";

/**
 * logBlockHistory
 * 
 * Records an entry in the audit trail.
 * Now requires HLC and Device timestamps to ensure causal integrity.
 */
export const logBlockHistory = (
  db: Kysely<Database> | Transaction<Database>,
  payload: {
    blockId: BlockId | NoteId;
    noteId: NoteId;
    userId: UserId;
    mutationType: string;
    args: unknown;
    snapshot?: unknown; 
    // The Three Times:
    hlcTimestamp: string;       // The Causal Truth
    deviceTimestamp: Date;      // The Untrusted Device Clock
  }
) =>
  Effect.tryPromise({
    try: async () => {
      const now = new Date(); // Server Physical Time

      const result = await db
        .insertInto("block_history")
        .values({
          block_id: payload.blockId as string,
          note_id: payload.noteId,
          user_id: payload.userId,
          mutation_type: payload.mutationType,
          change_delta: JSON.stringify(payload.args),
          content_snapshot: payload.snapshot ? JSON.stringify(payload.snapshot) : null,
          was_rejected: false, 
          
          // Time Metadata
          hlc_timestamp: payload.hlcTimestamp,
          device_timestamp: payload.deviceTimestamp,
          server_received_at: now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return result.id as string;
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
        .where("id", "=", historyId as BlockHistoryId)
        .execute(),
    catch: (cause) => new NoteDatabaseError({ cause }),
  });
