// FILE: src/features/note/history.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { handleCreateNote, handleUpdateTask, handleRevertBlock } from "./note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId } from "../../lib/shared/schemas";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../types";

vi.mock("../../lib/server/LinkService", () => ({
  updateLinksForNote: vi.fn(() => Effect.void),
}));

describe("History & Rollback (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let validUserId: UserId;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    const userId = randomUUID() as UserId;
    validUserId = userId; // Store for test body usage
    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;
    return async () => await cleanup();
  });

  const ageHistory = async (seconds: number) => {
      await db.updateTable("block_history")
        .set({
            // ✅ FIX: device_timestamp instead of timestamp
            device_timestamp: sql`device_timestamp - (${seconds} * interval '1 second')`
        })
        .execute();
  };

  it("should maintain a linear history and allow reverting a block to a previous state", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = validUserId; 
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        // 1. Create Note with a Task
        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "Audit Note",
          initialBlockId: blockId
        }, "1000:0000:TEST"); // ✅ FIX: Added HLC

        yield* Effect.promise(() => 
            db.updateTable("block")
              .set({ type: "task", fields: { is_complete: false, status: "todo" } })
              .where("id", "=", blockId)
              .execute()
        );

        yield* Effect.promise(() => ageHistory(3600));

        // 2. Mutation A
        yield* handleUpdateTask(db, {
            blockId,
            isComplete: true,
            version: 1
        }, userId, "2000:0000:TEST"); // ✅ FIX: Added HLC

        let block = yield* Effect.promise(() => 
            db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        // @ts-expect-error jsonb access
        expect(block.fields.is_complete).toBe(true);

        yield* Effect.promise(() => ageHistory(3600));

        // 3. Mutation B
        yield* handleUpdateTask(db, {
            blockId,
            isComplete: false,
            version: 2
        }, userId, "3000:0000:TEST"); // ✅ FIX: Added HLC

        block = yield* Effect.promise(() => 
            db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        // @ts-expect-error jsonb access
        expect(block.fields.is_complete).toBe(false);

        // 4. Fetch History
        const history = yield* Effect.promise(() => 
            db.selectFrom("block_history")
              .selectAll()
              .where("note_id", "=", noteId)
              // ✅ FIX: hlc_timestamp instead of timestamp
              .orderBy("hlc_timestamp", "desc")
              .execute()
        );

        expect(history).toHaveLength(3); 
        
        const targetEntry = history[1];
        if (!targetEntry) throw new Error("Target history entry not found");

        const tArgs = (typeof targetEntry.change_delta === 'string' 
            ? JSON.parse(targetEntry.change_delta) 
            : targetEntry.change_delta) as { isComplete: boolean };
        
        const targetSnapshot = {
            fields: {
                is_complete: tArgs.isComplete,
                status: tArgs.isComplete ? "done" : "todo"
            }
        };

        yield* Effect.promise(() => ageHistory(3600));

        // 5. Revert
        yield* handleRevertBlock(db, {
            blockId,
            historyId: targetEntry.id,
            targetSnapshot
        }, userId, "4000:0000:TEST"); // ✅ FIX: Added HLC

        const finalBlock = yield* Effect.promise(() => 
            db.selectFrom("block").select(["fields", "version"]).where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        
        // @ts-expect-error jsonb access
        expect(finalBlock.fields.is_complete).toBe(true);
        expect(finalBlock.version).toBe(4);
      })
    );
  });
});
