// File: src/features/note/mutations/delete.ts
import { Effect } from "effect";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError } from "../Errors";
import type { DeleteNoteArgsSchema } from "../note.schemas";
import type { UserId } from "../../../lib/shared/schemas";

export const handleDeleteNote = (
    db: Kysely<Database> | Transaction<Database>,
    args: typeof DeleteNoteArgsSchema.Type,
    _userId: UserId,
    globalVersion: string 
) =>
    Effect.gen(function* () {
        yield* Effect.tryPromise({
            try: async () => {
                // 1. Create Tombstones for Note and its children
                // ✅ Uses the passed HLC string for the delete version
                await sql`
                    INSERT INTO tombstone (entity_id, entity_type, deleted_at_version)
                    VALUES (${args.id}, 'note', ${globalVersion})
                `.execute(db);

                await sql`
                    INSERT INTO tombstone (entity_id, entity_type, deleted_at_version)
                    SELECT id, 'block', ${globalVersion} 
                    FROM block 
                    WHERE note_id = ${args.id}
                `.execute(db);

                await sql`
                    INSERT INTO tombstone (entity_id, entity_type, deleted_at_version)
                    SELECT t.id, 'task', ${globalVersion} 
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
        
        yield* Effect.logInfo(`[handleDeleteNote] Note ${args.id} deleted. HLC: ${globalVersion}`);
    });
