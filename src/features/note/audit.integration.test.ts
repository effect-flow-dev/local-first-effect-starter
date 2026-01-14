// FILE: src/features/note/audit.integration.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { handleUpdateBlock } from "./note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import type { UserId, NoteId, BlockId } from "../../lib/shared/schemas";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "../../types";
import { VersionConflictError } from "./Errors";

const TEST_HLC = "1736612345000:0001:TEST";

describe("Audit & Optimistic Locking (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let primaryUserId: UserId;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    const userId = randomUUID() as UserId;
    primaryUserId = userId;
    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;
    return async () => await cleanup();
  });

  const ensureUserExists = (userId: UserId) => 
    Effect.promise(async () => {
        const exists = await db.selectFrom("user").select("id").where("id", "=", userId).executeTakeFirst();
        if (!exists) {
            await db.insertInto("user").values({
                id: userId,
                email: `secondary-${userId}@test.com`,
                password_hash: "hash",
                email_verified: true,
                permissions: [],
                created_at: new Date()
            }).execute();
        }
    });

  const setupNoteWithBlock = (userId: UserId) =>
    Effect.gen(function* () {
      yield* ensureUserExists(userId);

      const noteId = randomUUID() as NoteId;
      const blockId = randomUUID() as BlockId;

      yield* Effect.promise(() =>
        db.insertInto("note").values({
            id: noteId, user_id: userId, title: "Test Note", content: { type: "doc", content: [] },
            version: 1, created_at: new Date(), updated_at: new Date(),
            global_version: TEST_HLC
        }).execute()
      );

      yield* Effect.promise(() =>
        db.insertInto("block").values({
            id: blockId, note_id: noteId, user_id: userId, type: "task", content: "",
            fields: { is_complete: false }, version: 1, file_path: "", depth: 0, order: 0,
            tags: [], links: [], transclusions: [], created_at: new Date(), updated_at: new Date(),
            global_version: TEST_HLC
        }).execute()
      );

      // Log initial creation history manually to simulate a real creation flow if needed by test logic,
      // but 'handleUpdateBlock' tests append-only logic. 
      // If we assume creation logged history, we'd insert one here.
      // For this specific test, we check if a NEW entry is added.

      return { noteId, blockId };
    });

  it("Scenario A: Successful update increments version and logs history", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = primaryUserId;
        const { blockId } = yield* setupNoteWithBlock(userId);

        yield* handleUpdateBlock(db, {
            blockId,
            fields: { is_complete: true },
            version: 1,
          },
          userId,
          "1736612346000:0001:TEST" 
        );

        const block = yield* Effect.promise(() =>
          db.selectFrom("block").select(["version", "fields"]).where("id", "=", blockId).executeTakeFirstOrThrow()
        );

        expect(block.version).toBe(2);
        // @ts-expect-error jsonb access
        expect(block.fields.is_complete).toBe(true);

        const history = yield* Effect.promise(() =>
            db.selectFrom("block_history").selectAll().where("block_id", "=", blockId).execute()
        );
        expect(history).toHaveLength(1);
      })
    );
  });

  it("Scenario B: Stale write is rejected and NOT logged (Linear History)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const user1 = primaryUserId;
        const user2 = randomUUID() as UserId;
        yield* ensureUserExists(user2); 

        const { blockId } = yield* setupNoteWithBlock(user1);

        // 1. User 1 Updates successfully -> Version 2
        yield* handleUpdateBlock(db, { blockId, fields: { is_complete: true }, version: 1 }, user1, "1736612347000:0001:U1");

        const blockV2 = yield* Effect.promise(() =>
            db.selectFrom("block").select("version").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        expect(blockV2.version).toBe(2);

        // 2. User 2 Tries to Update with STALE version 1
        const attempt = yield* Effect.either(
            handleUpdateBlock(db, { blockId, fields: { is_complete: false }, version: 1 }, user2, "1736612348000:0001:U2")
        );

        // 3. Expect Error
        expect(Either.isLeft(attempt)).toBe(true);
        if (Either.isLeft(attempt)) {
            expect(attempt.left).toBeInstanceOf(VersionConflictError);
        }

        // 4. Expect NO extra history entry (Linear History Immutability)
        const history = yield* Effect.promise(() =>
            db.selectFrom("block_history")
              .selectAll()
              .where("block_id", "=", blockId)
              .orderBy("hlc_timestamp", "asc")
              .execute()
        );

        // Should only have the one successful entry from User 1
        expect(history).toHaveLength(1);
        expect(history[0]!.user_id).toBe(user1);
      })
    );
  });
});
