// FILE: src/features/replicache/versioning.ts
import { Effect } from "effect";
import { sql, type Transaction, type Kysely } from "kysely";
import type { Database } from "../../types";

export const getCurrentGlobalVersion = (
  db: Kysely<Database> | Transaction<Database>,
) => 
  Effect.tryPromise({
    try: async () => {
        const [
            noteRes, 
            blockRes, 
            taskRes, 
            notebookRes, 
            tombstoneRes,
            historyRes // ✅ Check block_history too
        ] = await Promise.all([
            db.selectFrom("note").select(sql<string>`max(global_version)`.as("v")).executeTakeFirst(),
            db.selectFrom("block").select(sql<string>`max(global_version)`.as("v")).executeTakeFirst(),
            db.selectFrom("task").select(sql<string>`max(global_version)`.as("v")).executeTakeFirst(),
            db.selectFrom("notebook").select(sql<string>`max(global_version)`.as("v")).executeTakeFirst(),
            db.selectFrom("tombstone").select(sql<string>`max(deleted_at_version)`.as("v")).executeTakeFirst(),
            db.selectFrom("block_history").select(sql<string>`max(hlc_timestamp)`.as("v")).executeTakeFirst()
        ]);
        
        const versions = [
            noteRes?.v,
            blockRes?.v,
            taskRes?.v,
            notebookRes?.v,
            tombstoneRes?.v,
            historyRes?.v
        ];

        let maxVersion = "0";

        for (const v of versions) {
            // Ensure we are comparing strings
            if (v && String(v) > maxVersion) {
                maxVersion = String(v);
            }
        }

        return maxVersion;
    },
    catch: (cause) => new Error(`Failed to get current global version: ${String(cause)}`),
  });
