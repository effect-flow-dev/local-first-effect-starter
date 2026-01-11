// File: src/features/replicache/versioning.ts
import { Effect } from "effect";
import { sql, type Transaction, type Kysely } from "kysely";
import type { Database } from "../../types";

/**
 * getCurrentGlobalVersion
 * 
 * Fetches the current "High Water Mark" of the tenant's timeline.
 * Instead of a sequence, we query the maximum HLC timestamp from the history table.
 * This ensures that the Pull cookie accurately represents the latest causal event 
 * the server has processed.
 */
export const getCurrentGlobalVersion = (
  db: Kysely<Database> | Transaction<Database>,
) => 
  Effect.tryPromise({
    try: async () => {
        // We query the block_history table which is indexed on hlc_timestamp.
        // This is efficient and provides the true causal state of the tenant.
        const result = await db
            .selectFrom("block_history")
            .select(sql<string>`max(hlc_timestamp)`.as("maxHlc"))
            .executeTakeFirst();
        
        // If the database is fresh and no history exists, we return a 
        // base sortable string.
        return result?.maxHlc ?? "0";
    },
    catch: (cause) => new Error(`Failed to get current global version: ${String(cause)}`),
  });

// NOTE: getNextGlobalVersion has been removed. 
// Causal progression is now handled by the HLC 'tick' and 'receive' 
// logic within the handlePush transaction.
