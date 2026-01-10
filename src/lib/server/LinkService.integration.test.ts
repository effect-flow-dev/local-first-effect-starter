// FILE: src/lib/server/LinkService.integration.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { updateLinksForNote } from "./LinkService";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import type { UserId, NoteId, BlockId } from "../shared/schemas";
import { randomUUID } from "node:crypto";
import type { Database } from "../../types";
import type { Kysely } from "kysely";

describe("LinkService (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let validUserId: UserId;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    const userId = randomUUID() as UserId;
    validUserId = userId; // Store
    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;
    
    return async () => await cleanup();
  });

  // Use a generator function that takes userId
  const setupData = (userId: UserId) => Effect.gen(function* () {
    const sourceNoteId = randomUUID() as NoteId;
    const targetNoteId = randomUUID() as NoteId;
    const blockId = randomUUID() as BlockId;

    yield* Effect.promise(() =>
      db
        .insertInto("note")
        .values([
          { id: sourceNoteId, user_id: userId, title: "Source Note", content: {}, version: 1, created_at: new Date(), updated_at: new Date() },
          { id: targetNoteId, user_id: userId, title: "Target Note", content: {}, version: 1, created_at: new Date(), updated_at: new Date() },
        ])
        .execute(),
    );

    yield* Effect.promise(() =>
      db
        .insertInto("block")
        .values({
          id: blockId,
          user_id: userId,
          note_id: sourceNoteId,
          type: "paragraph",
          content: "Reference to [[Target Note]] here.",
          file_path: "",
          depth: 0,
          order: 0,
          fields: {},
          tags: [],
          links: [],
          transclusions: [],
          version: 1,
          created_at: new Date(),
          updated_at: new Date()
        })
        .execute(),
    );

    return { sourceNoteId, targetNoteId, blockId };
  });

  it("should resolve note titles to IDs and insert links", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = validUserId; // ✅ Use valid ID
        const { sourceNoteId, targetNoteId, blockId } = yield* setupData(userId);

        yield* updateLinksForNote(db, sourceNoteId, userId);

        const links = yield* Effect.promise(() =>
          db
            .selectFrom("link")
            .selectAll()
            .where("source_block_id", "=", blockId)
            .execute(),
        );

        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({
          source_block_id: blockId,
          target_note_id: targetNoteId,
        });
      }),
    );
  });

  it("should remove links when block content changes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = validUserId; // ✅ Use valid ID
        const { sourceNoteId, blockId } = yield* setupData(userId);

        yield* updateLinksForNote(db, sourceNoteId, userId);

        yield* Effect.promise(() =>
          db
            .updateTable("block")
            .set({ content: "No links anymore." })
            .where("id", "=", blockId)
            .execute(),
        );

        yield* updateLinksForNote(db, sourceNoteId, userId);

        const links = yield* Effect.promise(() =>
          db
            .selectFrom("link")
            .selectAll()
            .where("source_block_id", "=", blockId)
            .execute(),
        );

        expect(links).toHaveLength(0);
      }),
    );
  });
});
