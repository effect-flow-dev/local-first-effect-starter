// FILE: src/features/note/tombstone.integration.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { handleDeleteNote, handleCreateNote } from "./note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId } from "../../lib/shared/schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

describe("Tombstones (Integration)", () => {
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

  it("should create a tombstone record when a note is deleted", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = validUserId; // ✅ Use valid ID
        const noteId = randomUUID() as NoteId;

        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "To Be Deleted",
        });

        yield* handleDeleteNote(db, { id: noteId }, userId);

        const note = yield* Effect.promise(() =>
          db.selectFrom("note").selectAll().where("id", "=", noteId).executeTakeFirst()
        );
        expect(note).toBeUndefined();

        const tombstone = yield* Effect.promise(() =>
          db
            .selectFrom("tombstone")
            .selectAll()
            .where("entity_id", "=", noteId)
            .executeTakeFirst()
        );

        expect(tombstone).toBeDefined();
        expect(tombstone?.entity_type).toBe("note");
      })
    );
  });
});
