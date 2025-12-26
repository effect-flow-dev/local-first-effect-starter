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

describe("Audit & Optimistic Locking (Integration)", () => {
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

    return async () => {
      await cleanup();
    };
  });

  const setupNoteWithBlock = (userId: UserId) =>
    Effect.gen(function* () {
      const noteId = randomUUID() as NoteId;
      const blockId = randomUUID() as BlockId;

      yield* Effect.promise(() =>
        db
          .insertInto("note")
          .values({
            id: noteId,
            user_id: userId,
            title: "Test Note",
            content: {
              type: "doc",
              content: [
                {
                  type: "interactiveBlock",
                  attrs: {
                    blockId: blockId,
                    version: 1,
                    blockType: "task",
                    fields: { is_complete: false },
                  },
                },
              ],
            },
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute()
      );

      yield* Effect.promise(() =>
        db
          .insertInto("block")
          .values({
            id: blockId,
            note_id: noteId,
            user_id: userId,
            type: "task",
            content: "",
            fields: { is_complete: false },
            version: 1,
            file_path: "",
            depth: 0,
            order: 0,
            tags: [],
            links: [],
            transclusions: [],
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute()
      );

      return { noteId, blockId };
    });

  it("Scenario A: Successful update increments version and logs history", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = randomUUID() as UserId;
        const { blockId } = yield* setupNoteWithBlock(userId);

        yield* handleUpdateBlock(
          db,
          {
            blockId,
            fields: { is_complete: true },
            version: 1,
          },
          userId
        );

        const block = yield* Effect.promise(() =>
          db
            .selectFrom("block")
            .select(["version", "fields"])
            .where("id", "=", blockId)
            .executeTakeFirstOrThrow()
        );

        expect(block.version).toBe(2);
        // @ts-expect-error jsonb typing fallback
        expect(block.fields.is_complete).toBe(true);

        const history = yield* Effect.promise(() =>
          db
            .selectFrom("block_history")
            .selectAll()
            .where("block_id", "=", blockId)
            .execute()
        );

        expect(history).toHaveLength(1);
        expect(history[0]!.user_id).toBe(userId);
        expect(history[0]!.was_rejected).toBe(false);
        expect(history[0]!.change_delta).toMatchObject({
            blockId,
            fields: { is_complete: true },
            version: 1
        });
      })
    );
  });

  it("Scenario B: Stale write is rejected and logged", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const user1 = randomUUID() as UserId;
        const user2 = randomUUID() as UserId;

        const { blockId } = yield* setupNoteWithBlock(user1);

        // 1. User 1 Updates successfully
        yield* handleUpdateBlock(
          db,
          {
            blockId,
            fields: { is_complete: true },
            version: 1,
          },
          user1
        );

        const blockV2 = yield* Effect.promise(() =>
            db.selectFrom("block").select("version").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        expect(blockV2.version).toBe(2);

        // 2. User 2 Tries to Update with STALE version
        const attempt = yield* Effect.either(
            handleUpdateBlock(
                db,
                {
                    blockId,
                    fields: { is_complete: false },
                    version: 1,
                },
                user2
            )
        );

        expect(Either.isLeft(attempt)).toBe(true);
        if (Either.isLeft(attempt)) {
            expect(attempt.left).toBeInstanceOf(VersionConflictError);
        }

        const blockFinal = yield* Effect.promise(() =>
            db
              .selectFrom("block")
              .select(["version", "fields"])
              .where("id", "=", blockId)
              .executeTakeFirstOrThrow()
        );
        expect(blockFinal.version).toBe(2);
        // @ts-expect-error jsonb typing
        expect(blockFinal.fields.is_complete).toBe(true);

        const history = yield* Effect.promise(() =>
            db
              .selectFrom("block_history")
              .selectAll()
              .where("block_id", "=", blockId)
              .orderBy("timestamp", "asc")
              .execute()
        );

        expect(history).toHaveLength(2);

        // Entry 1
        expect(history[0]!.user_id).toBe(user1);
        expect(history[0]!.was_rejected).toBe(false);

        // Entry 2
        expect(history[1]!.user_id).toBe(user2);
        expect(history[1]!.was_rejected).toBe(true);
        expect(history[1]!.change_delta).toMatchObject({
            blockId,
            fields: { is_complete: false },
            version: 1
        });
      })
    );
  });
});
