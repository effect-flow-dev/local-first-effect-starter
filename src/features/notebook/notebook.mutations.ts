// FILE: src/features/notebook/notebook.mutations.ts
import { Effect, Schema } from "effect";
import { sql, type Transaction, type Kysely } from "kysely";
import type { Database } from "../../types";
import { NotebookIdSchema } from "../../lib/shared/schemas";
import { NotebookDatabaseError } from "./Errors";
import { getNextGlobalVersion } from "../replicache/versioning";
import { NoteDatabaseError } from "../note/Errors";

export const CreateNotebookArgsSchema = Schema.Struct({
  id: NotebookIdSchema,
  name: Schema.String,
});

export const DeleteNotebookArgsSchema = Schema.Struct({
  id: NotebookIdSchema,
});

export const handleCreateNotebook = (
  db: Kysely<Database> | Transaction<Database>,
  args: typeof CreateNotebookArgsSchema.Type,
  userId: string
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[handleCreateNotebook] ID: ${args.id}`);

    const globalVersion = yield* getNextGlobalVersion(db);

    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto("notebook")
          .values({
            id: args.id,
            user_id: userId,
            name: args.name,
            created_at: sql<Date>`now()`,
            global_version: String(globalVersion),
          })
          .execute(),
      catch: (cause) => new NotebookDatabaseError({ cause }),
    });
  });

export const handleDeleteNotebook = (
  db: Kysely<Database> | Transaction<Database>,
  args: typeof DeleteNotebookArgsSchema.Type,
  _userId: string
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[handleDeleteNotebook] ID: ${args.id}`);

    const globalVersion = yield* getNextGlobalVersion(db);

    // 1. Create Tombstone for Notebook
    yield* Effect.tryPromise({
      try: () =>
        sql`
          INSERT INTO tombstone (entity_id, entity_type, deleted_at_version)
          VALUES (${args.id}, 'notebook', ${String(globalVersion)})
        `.execute(db),
      catch: (cause) => new NotebookDatabaseError({ cause }),
    });

    // 2. Handle Orphaned Notes
    // The DB has "ON DELETE SET NULL", but we need to bump the version of affected notes
    // so clients know they have been moved to "Inbox" (null notebook).
    yield* Effect.tryPromise({
      try: () =>
        db
          .updateTable("note")
          .set({
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            global_version: String(globalVersion),
          })
          .where("notebook_id", "=", args.id)
          .execute(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    // 3. Delete Notebook
    // This will trigger the FK constraint to set notebook_id=null on notes if step 2 didn't strictly do it
    yield* Effect.tryPromise({
      try: () =>
        db
          .deleteFrom("notebook")
          .where("id", "=", args.id)
          .execute(),
      catch: (cause) => new NotebookDatabaseError({ cause }),
    });
  });
