// FILE: src/lib/server/TaskService.integration.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { syncTasksForNote } from "./TaskService";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import type { UserId, NoteId, BlockId } from "../shared/schemas";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

const NOTE_ID = randomUUID() as NoteId;
const BLOCK_ID_1 = randomUUID() as BlockId;
const BLOCK_ID_2 = randomUUID() as BlockId;

describe("TaskService (Integration)", () => {
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

  const seedData = (blocks: Array<{ id: BlockId; content: string }>) =>
    Effect.gen(function* () {
      // ✅ Use validUserId
      yield* Effect.promise(() =>
        db
          .insertInto("note")
          .values({
            id: NOTE_ID,
            user_id: validUserId,
            title: "Test Note",
            content: {},
            version: 1, created_at: new Date(), updated_at: new Date()
          })
          .execute(),
      );

      if (blocks.length > 0) {
        yield* Effect.promise(() =>
          db
            .insertInto("block")
            .values(
              blocks.map((b) => ({
                id: b.id,
                user_id: validUserId,
                note_id: NOTE_ID,
                type: "paragraph",
                content: b.content,
                file_path: "",
                depth: 0,
                order: 0,
                fields: {},
                tags: [], links: [], transclusions: [],
                version: 1, created_at: new Date(), updated_at: new Date()
              })),
            )
            .execute(),
        );
      }
    });

  it("should clear existing tasks and insert new ones based on blocks", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedData([
          { id: BLOCK_ID_1, content: "Just text" },
          { id: BLOCK_ID_2, content: "- [ ] Buy Milk" },
        ]);

        yield* syncTasksForNote(db, NOTE_ID, validUserId);

        const tasks = yield* Effect.promise(() =>
          db
            .selectFrom("task")
            .selectAll()
            .where("user_id", "=", validUserId)
            .execute(),
        );

        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
          source_block_id: BLOCK_ID_2,
          content: "Buy Milk",
          is_complete: false,
        });
      }),
    );
  });

  it("should update existing task status if block changes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedData([{ id: BLOCK_ID_1, content: "- [x] Finished Job" }]);

        yield* syncTasksForNote(db, NOTE_ID, validUserId);

        const tasks = yield* Effect.promise(() =>
          db.selectFrom("task").selectAll().execute(),
        );

        expect(tasks).toHaveLength(1);
        expect(tasks[0]?.is_complete).toBe(true);
      }),
    );
  });
});
