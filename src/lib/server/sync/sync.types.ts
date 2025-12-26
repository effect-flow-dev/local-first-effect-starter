// FILE: src/lib/server/sync/sync.types.ts
import type { Transaction } from "kysely";
import type { Effect } from "effect";
import type { Database } from "../../../types";
import type { PullResponse, SyncFilter } from "../../shared/replicache-schemas";
import type { UserId } from "../../shared/schemas";

/**
 * The contract that any syncable data type must adhere to.
 */
export interface SyncableEntity {
  /** 
   * An Effect that calculates the patch operations (put, del) for this entity.
   * 
   * @param trx The database transaction
   * @param userId The user requesting the sync
   * @param sinceVersion The last global_version the client has seen
   * @param filter The active lens filter (optional)
   */
  readonly getPatchOperations: (
    trx: Transaction<Database>,
    userId: UserId,
    sinceVersion: number,
    filter?: SyncFilter, // ✅ NEW: Filter parameter
  ) => Effect.Effect<PullResponse["patch"], unknown>;
}
