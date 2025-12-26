// FILE: src/features/note/history.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { handleCreateNote, handleUpdateTask, handleRevertBlock } from "./note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId } from "../../lib/shared/schemas";
import { sql, type Kysely } from "kysely"; // ✅ Import sql
import type { Database } from "../../types";

// Mock LinkService to avoid side effects
vi.mock("../../lib/server/LinkService", () => ({
  updateLinksForNote: vi.fn(() => Effect.void),
}));

describe("History & Rollback (Integration)", () => {
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

  // Helper to artificially age the history timestamps
  const ageHistory = async (seconds: number) => {
      // ✅ FIX: Use top-level sql template tag and standard Postgres interval math
      await db.updateTable("block_history")
        .set({
            timestamp: sql`timestamp - (${seconds} * interval '1 second')`
        })
        .execute();
  };

  it("should maintain a linear history and allow reverting a block to a previous state", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = randomUUID() as UserId;
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        // 1. Create Note with a Task
        // History Entry #3 (Oldest): createNote
        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "Audit Note",
          initialBlockId: blockId
        });

        // Initialize block as a task manually since createNote defaults to paragraph
        yield* Effect.promise(() => 
            db.updateTable("block")
              .set({ type: "task", fields: { is_complete: false, status: "todo" } })
              .where("id", "=", blockId)
              .execute()
        );

        // FORCE TIME GAP (> 20 mins) to prevent session merge
        // We simulate the previous entry being 1 hour old
        yield* Effect.promise(() => ageHistory(3600));

        // 2. Mutation A: Mark as Complete (v2)
        // History Entry #2: updateTask
        yield* handleUpdateTask(db, {
            blockId,
            isComplete: true,
            version: 1
        }, userId);

        let block = yield* Effect.promise(() => 
            db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        // @ts-expect-error jsonb access
        expect(block.fields.is_complete).toBe(true);

        // FORCE TIME GAP (> 20 mins)
        yield* Effect.promise(() => ageHistory(3600));

        // 3. Mutation B: Mark as Incomplete (v3)
        // History Entry #1 (Newest): updateTask
        yield* handleUpdateTask(db, {
            blockId,
            isComplete: false,
            version: 2
        }, userId);

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
              .orderBy("timestamp", "desc")
              .execute()
        );

        // Expect 3 distinct entries because we forced time gaps
        expect(history).toHaveLength(3); 
        
        const targetEntry = history[1];
        if (!targetEntry) throw new Error("Target history entry not found");

        const targetArgs = typeof targetEntry.change_delta === 'string' 
            ? JSON.parse(targetEntry.change_delta) 
            : targetEntry.change_delta;
            
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tArgs = targetArgs as any;
        const targetSnapshot = {
            fields: {
                is_complete: tArgs.isComplete,
                status: tArgs.isComplete ? "done" : "todo"
            }
        };

        // FORCE TIME GAP before revert
        yield* Effect.promise(() => ageHistory(3600));

        // 5. Revert to Mutation A (v4)
        yield* handleRevertBlock(db, {
            blockId,
            historyId: targetEntry.id,
            targetSnapshot
        }, userId);

        // 6. Verify State
        const finalBlock = yield* Effect.promise(() => 
            db.selectFrom("block").select(["fields", "version"]).where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        
        // Should be True again
        // @ts-expect-error jsonb access
        expect(finalBlock.fields.is_complete).toBe(true);
        // Version should have bumped
        expect(finalBlock.version).toBe(4);

        // 7. Verify Audit Trail
        const newHistory = yield* Effect.promise(() => 
            db.selectFrom("block_history")
              .selectAll()
              .where("note_id", "=", noteId) 
              .orderBy("timestamp", "desc")
              .execute()
        );
        
        expect(newHistory).toHaveLength(4);
        
        const latestEntry = newHistory[0];
        if (!latestEntry) throw new Error("Latest history entry not found");
        
        expect(latestEntry.mutation_type).toBe("revertBlock");
      })
    );
  });
});
