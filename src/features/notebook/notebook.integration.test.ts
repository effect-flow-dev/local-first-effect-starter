// FILE: src/features/notebook/notebook.integration.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { handleCreateNotebook, handleDeleteNotebook } from "./notebook.mutations";
import { handleCreateNote } from "../note/note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, NotebookId } from "../../lib/shared/schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

describe("Notebooks (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    const userId = randomUUID();
    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;
    return async () => await cleanup();
  });

  const setupUser = Effect.gen(function* () {
    return randomUUID() as UserId;
  });

  it("handleCreateNotebook should persist a notebook", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = yield* setupUser;
        const notebookId = randomUUID() as NotebookId;

        yield* handleCreateNotebook(
          db,
          { id: notebookId, name: "Work Projects" },
          userId
        );

        const row = yield* Effect.promise(() =>
          db
            .selectFrom("notebook")
            .selectAll()
            .where("id", "=", notebookId)
            .executeTakeFirst()
        );

        expect(row).toBeDefined();
        expect(row?.name).toBe("Work Projects");
        expect(row?.user_id).toBe(userId);
        expect(Number(row?.global_version)).toBeGreaterThan(0);
      })
    );
  });

  it("handleCreateNote should correctly link to a notebook", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = yield* setupUser;
        const notebookId = randomUUID() as NotebookId;
        const noteId = randomUUID() as NoteId;

        // 1. Create Notebook
        yield* handleCreateNotebook(
          db,
          { id: notebookId, name: "Personal" },
          userId
        );

        // 2. Create Note inside Notebook
        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "My Diary",
          notebookId: notebookId,
        });

        // 3. Verify Link
        const note = yield* Effect.promise(() =>
          db
            .selectFrom("note")
            .select(["id", "notebook_id"])
            .where("id", "=", noteId)
            .executeTakeFirstOrThrow()
        );

        expect(note.notebook_id).toBe(notebookId);
      })
    );
  });

  it("handleDeleteNotebook should remove notebook and orphan notes (set null)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = yield* setupUser;
        const notebookId = randomUUID() as NotebookId;
        const noteId = randomUUID() as NoteId;

        // 1. Setup Data
        yield* handleCreateNotebook(db, { id: notebookId, name: "To Delete" }, userId);
        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "Linked Note",
          notebookId: notebookId,
        });

        const initialNote = yield* Effect.promise(() =>
            db.selectFrom("note").select("version").where("id", "=", noteId).executeTakeFirstOrThrow()
        );
        const initialVersion = initialNote.version;

        // 2. Delete Notebook
        yield* handleDeleteNotebook(db, { id: notebookId }, userId);

        // 3. Verify Notebook Gone
        const nbRow = yield* Effect.promise(() =>
          db.selectFrom("notebook").select("id").where("id", "=", notebookId).executeTakeFirst()
        );
        expect(nbRow).toBeUndefined();

        // 4. Verify Tombstone Created
        const tombstone = yield* Effect.promise(() =>
            db.selectFrom("tombstone").selectAll().where("entity_id", "=", notebookId).executeTakeFirst()
        );
        expect(tombstone).toBeDefined();
        expect(tombstone?.entity_type).toBe("notebook");

        // 5. Verify Note Orphaned (notebook_id IS NULL)
        const updatedNote = yield* Effect.promise(() =>
          db.selectFrom("note").selectAll().where("id", "=", noteId).executeTakeFirstOrThrow()
        );
        
        expect(updatedNote.notebook_id).toBeNull();
        
        // 6. Verify Note Version Bumped (Crucial for Sync)
        // The mutation explicitly bumps version so clients pull the update
        expect(updatedNote.version).toBeGreaterThan(initialVersion || 0);
      })
    );
  });
});
