import { Effect } from "effect";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError } from "../Errors";
import { getNextGlobalVersion } from "../../replicache/versioning";
// REMOVED: import { logBlockHistory } from "../history.utils";
import type { DeleteNoteArgsSchema } from "../note.schemas";
import type { UserId } from "../../../lib/shared/schemas";

export const handleDeleteNote = (
    db: Kysely<Database> | Transaction<Database>,
    args: typeof DeleteNoteArgsSchema.Type,
    _userId: UserId, 
) =>
    Effect.gen(function* () {
        // ✅ FIX: logBlockHistory removed for deleteNote.
        // Because 'block_history' has a cascading FK to 'note', the log entry 
        // would be deleted instantly when the note is deleted.
        // In a local-first system, the Tombstone is the primary record of deletion.
        
        const globalVersion = yield* getNextGlobalVersion(db);

        yield* Effect.tryPromise({
            try: async () => {
                // 1. Create Tombstones for Note and its children
                await sql`
                    INSERT INTO tombstone (entity_id, entity_type, deleted_at_version)
                    VALUES (${args.id}, 'note', ${String(globalVersion)})
                `.execute(db);

                await sql`
                    INSERT INTO tombstone (entity_id, entity_type, deleted_at_version)
                    SELECT id, 'block', ${String(globalVersion)}
                    FROM block
                    WHERE note_id = ${args.id}
                `.execute(db);

                await sql`
                    INSERT INTO tombstone (entity_id, entity_type, deleted_at_version)
                    SELECT t.id, 'task', ${String(globalVersion)}
                    FROM task t
                    JOIN block b ON t.source_block_id = b.id
                    WHERE b.note_id = ${args.id}
                `.execute(db);

                // 2. Perform Cascading Delete
                await db
                    .deleteFrom("note")
                    .where("id", "=", args.id)
                    .execute();
            },
            catch: (cause) => new NoteDatabaseError({ cause }),
        });
        
        yield* Effect.logInfo(`[handleDeleteNote] Note ${args.id} and children deleted with tombstones.`);
    });
