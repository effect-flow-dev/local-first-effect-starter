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

  it("should create a tombstone record when a note is deleted", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = randomUUID() as UserId;
        const noteId = randomUUID() as NoteId;

        // 1. Create Note
        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "To Be Deleted",
        });

        // 2. Delete Note
        yield* handleDeleteNote(db, { id: noteId }, userId);

        // 3. Verify Note is gone
        const note = yield* Effect.promise(() =>
          db.selectFrom("note").selectAll().where("id", "=", noteId).executeTakeFirst()
        );
        expect(note).toBeUndefined();

        // 4. Verify Tombstone exists
        const tombstone = yield* Effect.promise(() =>
          db
            .selectFrom("tombstone")
            .selectAll()
            .where("entity_id", "=", noteId)
            .executeTakeFirst()
        );

        expect(tombstone).toBeDefined();
        expect(tombstone?.entity_type).toBe("note");
        // Ensure deleted_at_version is set (it's a string from DB bigint)
        expect(Number(tombstone?.deleted_at_version)).toBeGreaterThan(0);
      })
    );
  });
});
