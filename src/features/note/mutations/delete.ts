// FILE: src/features/note/mutations/delete.ts
import { Effect } from "effect";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError } from "../Errors";
import { getNextGlobalVersion } from "../../replicache/versioning";
import { logBlockHistory } from "../history.utils";
import type { DeleteNoteArgsSchema } from "../note.schemas";
import type { UserId } from "../../../lib/shared/schemas";

export const handleDeleteNote = (
  db: Kysely<Database> | Transaction<Database>,
  args: typeof DeleteNoteArgsSchema.Type,
  userId: UserId, 
) =>
  Effect.gen(function* () {
    yield* logBlockHistory(db, {
      blockId: args.id,
      noteId: args.id,
      userId: userId,
      mutationType: "deleteNote",
      args: args
    });

    const globalVersion = yield* getNextGlobalVersion(db);

    yield* Effect.tryPromise({
      try: async () => {
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

        await db
          .deleteFrom("note")
          .where("id", "=", args.id)
          .execute();
      },
      catch: (cause) => new NoteDatabaseError({ cause }),
    });
  });
