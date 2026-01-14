// FILE: src/features/note/history.utils.ts
import { Effect } from "effect";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../../types";
import type { NoteId, UserId, BlockId } from "../../lib/shared/schemas";
import { NoteDatabaseError } from "./Errors";

/**
 * logBlockHistory
 * 
 * Records an entry in the audit trail (Immutable/Append-Only).
 * 
 * Updates for Phase 2 (Causal Linking):
 * - Accepts `revertedFromHistoryId` to explicitly link correction events to the 
 *   specific history entry they are correcting (e.g. undoing a mistake).
 * - Stores this link inside the `change_delta` JSONB to avoid schema changes while 
 *   preserving forensic traceability.
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
    
    // Location Context
    entityId?: string | null;
    locationSource?: string;
    locationAccuracy?: number | null;

    // ✅ Causal Linking (Linear History)
    // If this event is a revert/correction, this ID points to the event being "undone".
    revertedFromHistoryId?: string;
  }
) =>
  Effect.tryPromise({
    try: async () => {
      const now = new Date(); // Server Physical Time

      // Construct the Delta JSON
      // We merge the causal link into the args so it is queryable within the JSONB
      const argsObject = (typeof payload.args === 'object' && payload.args !== null)
        ? payload.args
        : { value: payload.args };

      const changeDelta = payload.revertedFromHistoryId
        ? { ...argsObject, revertedFromHistoryId: payload.revertedFromHistoryId }
        : argsObject;

      const result = await db
        .insertInto("block_history")
        .values({
          block_id: payload.blockId as string,
          note_id: payload.noteId,
          user_id: payload.userId,
          mutation_type: payload.mutationType,
          change_delta: JSON.stringify(changeDelta),
          content_snapshot: payload.snapshot ? JSON.stringify(payload.snapshot) : null,
          was_rejected: false, // Always false in Linear History (we strictly append)
          
          // Time Metadata
          hlc_timestamp: payload.hlcTimestamp,
          device_timestamp: payload.deviceTimestamp,
          server_received_at: now,

          // Location Context
          entity_id: payload.entityId,
          location_source: payload.locationSource,
          location_accuracy: payload.locationAccuracy,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return result.id as string;
    },
    catch: (cause) => new NoteDatabaseError({ cause }),
  });
