// File: ./src/features/notebook/notebook.integration.test.ts
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
  let validUserId: UserId;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    const userId = randomUUID() as UserId;
    validUserId = userId;
    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;
    return async () => await cleanup();
  });

  const setupUser = Effect.gen(function* () {
    return validUserId;
  });

  it("handleCreateNotebook should persist a notebook", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = yield* setupUser;
        const notebookId = randomUUID() as NotebookId;
        const hlc = "1736612345678:0001:TEST";

        yield* handleCreateNotebook(
          db,
          { id: notebookId, name: "Work Projects" },
          userId,
          hlc
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
        expect(row?.global_version).toBe(hlc);
      })
    );
  });

  it("handleCreateNote should correctly link to a notebook", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = yield* setupUser;
        const notebookId = randomUUID() as NotebookId;
        const noteId = randomUUID() as NoteId;
        const hlc = "1736612345678:0002:TEST";

        yield* handleCreateNotebook(db, { id: notebookId, name: "Personal" }, userId, hlc);

        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "My Diary",
          notebookId: notebookId,
        }, hlc);

        const note = yield* Effect.promise(() =>
          db.selectFrom("note").select(["id", "notebook_id"]).where("id", "=", noteId).executeTakeFirstOrThrow()
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
        const hlc = "1736612345678:0003:TEST";

        yield* handleCreateNotebook(db, { id: notebookId, name: "To Delete" }, userId, hlc);
        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "Linked Note",
          notebookId: notebookId,
        }, hlc);

        yield* handleDeleteNotebook(db, { id: notebookId }, userId, hlc);

        const nbRow = yield* Effect.promise(() =>
          db.selectFrom("notebook").select("id").where("id", "=", notebookId).executeTakeFirst()
        );
        expect(nbRow).toBeUndefined();

        const updatedNote = yield* Effect.promise(() =>
          db.selectFrom("note").selectAll().where("id", "=", noteId).executeTakeFirstOrThrow()
        );
        expect(updatedNote.notebook_id).toBeNull();
        expect(updatedNote.global_version).toBe(hlc);
      })
    );
  });
});
