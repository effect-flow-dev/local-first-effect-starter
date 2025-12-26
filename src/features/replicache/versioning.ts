// FILE: src/features/replicache/versioning.ts
import { Effect } from "effect";
import { sql, type Transaction, type Kysely } from "kysely";
import type { Database } from "../../types";

/**
 * Fetches the next global version (tick) from the database sequence.
 * Used during MUTATIONS (Push) to stamp new changes.
 */
export const getNextGlobalVersion = (
  db: Kysely<Database> | Transaction<Database>,
) =>
  Effect.tryPromise({
    try: async () => {
      const result = await sql<{
        nextval: string;
      }>`select nextval('global_version_seq')`.execute(db);
      // Postgres sequences return strings for 64-bit integers.
      return Number(result.rows[0]?.nextval);
    },
    catch: (cause) => new Error(`Failed to get next global version: ${String(cause)}`),
  });

/**
 * Fetches the current value of the global version sequence.
 * Used during PULL to determine the "High Water Mark" (next cookie).
 */
export const getCurrentGlobalVersion = (
  db: Kysely<Database> | Transaction<Database>,
) => 
  Effect.tryPromise({
    try: async () => {
        // Queries the sequence state without incrementing it.
        const result = await sql<{ last_value: string; is_called: boolean }>`
            SELECT last_value, is_called FROM global_version_seq
        `.execute(db);
        
        const row = result.rows[0];
        if (!row) return 0;

        const val = Number(row.last_value);
        
        // If the sequence hasn't been called yet (fresh DB), the "current" valid high-water mark is 0.
        // The first nextval() call will return 1.
        if (!row.is_called) {
            return Math.max(0, val - 1);
        }
        return val;
    },
    catch: (cause) => new Error(`Failed to get current global version: ${String(cause)}`),
  });
