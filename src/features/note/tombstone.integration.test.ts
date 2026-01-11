// File: ./src/features/note/tombstone.integration.test.ts
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

  it("should create a tombstone record with HLC version", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = validUserId;
        const noteId = randomUUID() as NoteId;
        const hlc = "1736612345678:0001:TEST";

        yield* handleCreateNote(db, { id: noteId, userID: userId, title: "To Be Deleted" }, hlc);
        yield* handleDeleteNote(db, { id: noteId }, userId, hlc);

        const tombstone = yield* Effect.promise(() =>
          db.selectFrom("tombstone").selectAll().where("entity_id", "=", noteId).executeTakeFirst()
        );

        expect(tombstone).toBeDefined();
        expect(tombstone?.deleted_at_version).toBe(hlc);
      })
    );
  });
});
