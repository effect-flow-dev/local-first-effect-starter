// FILE: src/features/notebook/notebook.mutations.ts
import { Effect, Schema } from "effect";
import { sql, type Transaction, type Kysely } from "kysely";
import type { Database } from "../../types";
import { NotebookIdSchema, type UserId } from "../../lib/shared/schemas";
import { NotebookDatabaseError } from "./Errors";
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
  userId: string,
  globalVersion: string // ✅ Added HLC parameter
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[handleCreateNotebook] ID: ${args.id}`);

    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto("notebook")
          .values({
            id: args.id,
            user_id: userId as UserId, 
            name: args.name,
            created_at: sql<Date>`now()`,
            global_version: globalVersion, // ✅ Use HLC
          })
          .execute(),
      catch: (cause) => new NotebookDatabaseError({ cause }),
    });
  });

export const handleDeleteNotebook = (
  db: Kysely<Database> | Transaction<Database>,
  args: typeof DeleteNotebookArgsSchema.Type,
  _userId: string,
  globalVersion: string // ✅ Added HLC parameter
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[handleDeleteNotebook] ID: ${args.id}`);

    // 1. Create Tombstone for Notebook
    yield* Effect.tryPromise({
      try: () =>
        sql`
          INSERT INTO tombstone (entity_id, entity_type, deleted_at_version)
          VALUES (${args.id}, 'notebook', ${globalVersion})
        `.execute(db),
      catch: (cause) => new NotebookDatabaseError({ cause }),
    });

    // 2. Handle Orphaned Notes
    yield* Effect.tryPromise({
      try: () =>
        db
          .updateTable("note")
          .set({
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            global_version: globalVersion, // ✅ Use HLC
          })
          .where("notebook_id", "=", args.id)
          .execute(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    // 3. Delete Notebook
    yield* Effect.tryPromise({
      try: () =>
        db
          .deleteFrom("notebook")
          .where("id", "=", args.id)
          .execute(),
      catch: (cause) => new NotebookDatabaseError({ cause }),
    });
  });
