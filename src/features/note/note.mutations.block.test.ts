// FILE: src/features/note/note.mutations.block.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { handleUpdateBlock } from "./note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, BlockId, NoteId } from "../../lib/shared/schemas";
import { sql, type Kysely } from "kysely"; // ✅ Import 'sql'
import type { Database } from "../../types";
import { VersionConflictError } from "./Errors";

const INITIAL_HLC = "1736612345000:0001:TEST";
const NEXT_HLC = "1736612346000:0001:TEST";

describe("handleUpdateBlock Mutation (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let userId: UserId;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    const id = randomUUID() as UserId;
    userId = id;
    const setup = await createTestUserSchema(id);
    db = setup.db;
    cleanup = setup.cleanup;
    return async () => {
      await cleanup();
    };
  });

  // --- Data Seeding Helper ---
  const setupTestBlock = (db: Kysely<Database>, userId: UserId) =>
    Effect.gen(function* () {
      const noteId = randomUUID() as NoteId;
      const blockId = randomUUID() as BlockId;

      yield* Effect.promise(() =>
        db
          .insertInto("note")
          .values({
            id: noteId,
            user_id: userId,
            title: "Integration Test Note",
            content: { type: "doc", content: [] },
            version: 1,
            // ✅ FIX: Use DB clock for consistency
            created_at: sql`now()`,
            updated_at: sql`now()`,
            global_version: INITIAL_HLC,
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
            type: "interactiveBlock",
            content: "",
            fields: { status: "open", width: 100 },
            file_path: "",
            depth: 0,
            order: 0,
            tags: [],
            links: [],
            transclusions: [],
            version: 1,
            // ✅ FIX: Use DB clock for consistency
            created_at: sql`now()`,
            updated_at: sql`now()`,
            global_version: INITIAL_HLC,
          })
          .execute()
      );

      return { noteId, blockId };
    });

  it("Scenario A: Successful update merges fields, increments version, and persists data", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { blockId } = yield* setupTestBlock(db, userId);

        yield* handleUpdateBlock(
          db,
          {
            blockId,
            fields: { status: "closed", height: 50 },
            version: 1, 
          },
          userId,
          NEXT_HLC
        );

        const block = yield* Effect.promise(() =>
          db
            .selectFrom("block")
            .selectAll()
            .where("id", "=", blockId)
            .executeTakeFirstOrThrow()
        );

        const fields = block.fields as Record<string, unknown>;

        expect(fields["status"]).toBe("closed"); 
        expect(fields["width"]).toBe(100);       
        expect(fields["height"]).toBe(50);       

        expect(block.version).toBe(2);
        
        // Assert timestamps match ordering (Updated >= Created)
        expect(block.updated_at.getTime()).toBeGreaterThanOrEqual(block.created_at.getTime());
      })
    );
  });

  it("Scenario B: Stale write (Version Conflict) fails and does NOT log history", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { blockId } = yield* setupTestBlock(db, userId);

        // 1. Manually bump version to simulate race
        yield* Effect.promise(() => 
          db.updateTable("block").set({ version: 2 }).where("id", "=", blockId).execute()
        );

        const result = yield* Effect.either(
            handleUpdateBlock(
                db,
                { blockId, fields: { status: "investigation_pending" }, version: 1 }, // Stale
                userId,
                NEXT_HLC
            )
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left).toBeInstanceOf(VersionConflictError);
        }

        const history = yield* Effect.promise(() =>
          db
            .selectFrom("block_history")
            .selectAll()
            .where("block_id", "=", blockId)
            .execute()
        );
        expect(history).toHaveLength(0);
      })
    );
  });

  it("Scenario C: Concurrency & HLC Integrity", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { blockId } = yield* setupTestBlock(db, userId);

        yield* handleUpdateBlock(
          db,
          { blockId, fields: { foo: "bar" }, version: 1 },
          userId,
          NEXT_HLC 
        );

        const block = yield* Effect.promise(() =>
          db
            .selectFrom("block")
            .select("global_version")
            .where("id", "=", blockId)
            .executeTakeFirstOrThrow()
        );

        expect(block.global_version).toBe(NEXT_HLC);
      })
    );
  });

  it("Scenario D: Idempotency - does not crash or create phantom records if block does not exist", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const phantomId = randomUUID() as BlockId;

        yield* handleUpdateBlock(
          db,
          { blockId: phantomId, fields: { status: "active" }, version: 1 },
          userId,
          NEXT_HLC
        );

        const block = yield* Effect.promise(() =>
          db.selectFrom("block").select("id").where("id", "=", phantomId).executeTakeFirst()
        );
        expect(block).toBeUndefined();

        const history = yield* Effect.promise(() =>
          db.selectFrom("block_history").select("id").where("block_id", "=", phantomId).execute()
        );
        expect(history).toHaveLength(0);
      })
    );
  });
});
