// FILE: src/features/note/history.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { 
  handleCreateNote, 
  handleCreateBlock, 
  handleUpdateBlock, 
  handleRevertBlock 
} from "./note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId } from "../../lib/shared/schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

// Standardized HLCs for Linear Time T1 < T2 < T3
const T0_HLC = "1736612344000:0001:TEST"; // Note Creation
const T1_HLC = "1736612345000:0001:TEST"; // Block Creation
const T2_HLC = "1736612346000:0001:TEST"; // Bad Update
const T3_HLC = "1736612347000:0001:TEST"; // Correction (Revert)

vi.mock("../../lib/server/LinkService", () => ({
  updateLinksForNote: vi.fn(() => Effect.void),
}));

describe("Forensic Audit & Linear History (Integration)", () => {
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

  it("maintains an insert-only, linear audit trail during a revert operation", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = validUserId;
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        // ---------------------------------------------------------
        // T0: Setup Note
        // ---------------------------------------------------------
        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "Forensic Log",
        }, T0_HLC);

        // ---------------------------------------------------------
        // T1: Creation (The "Good" State)
        // ---------------------------------------------------------
        yield* handleCreateBlock(db, {
            noteId,
            blockId,
            type: "form_meter",
            fields: { 
                value: 100, 
                min: 0, 
                max: 1000, 
                label: "Safe Meter", 
                unit: "points" 
            }
        }, userId, T1_HLC);

        // Capture the "Good" History ID to revert to later
        const t1History = yield* Effect.promise(() => 
            db.selectFrom("block_history")
              .select("id")
              .where("block_id", "=", blockId)
              .where("hlc_timestamp", "=", T1_HLC)
              .executeTakeFirstOrThrow()
        );

        // ---------------------------------------------------------
        // T2: Update (The "Bad" State / Mistake)
        // ---------------------------------------------------------
        yield* handleUpdateBlock(db, {
            blockId,
            fields: { value: 9999 }, // Bad Value
            version: 1
        }, userId, T2_HLC);

        // Verify "Bad" State exists
        let block = yield* Effect.promise(() => 
            db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        
        // Use type assertion to avoid property access errors on unknown
        const badFields = block.fields as { value: number };
        expect(badFields.value).toBe(9999);

        // ---------------------------------------------------------
        // T3: Revert (The Correction)
        // ---------------------------------------------------------
        // We revert TO T1. This should create a new event T3.
        const snapshotOfT1 = { 
            fields: { value: 100 } // Restoring simple field subset for test
        };

        yield* handleRevertBlock(db, {
            blockId,
            historyId: t1History.id, // Pointing to T1
            targetSnapshot: snapshotOfT1
        }, userId, T3_HLC);

        // ---------------------------------------------------------
        // FORENSIC VERIFICATION
        // ---------------------------------------------------------

        // 1. Fetch Full History
        const history = yield* Effect.promise(() => 
            db.selectFrom("block_history")
              .selectAll()
              .where("block_id", "=", blockId)
              .orderBy("hlc_timestamp", "asc") // T1 -> T2 -> T3
              .execute()
        );

        // Assertion: Strictly 3 rows (Insert-Only)
        expect(history).toHaveLength(3);

        const [row1, row2, row3] = history;

        // 2. Verify Linearity
        expect(row1!.hlc_timestamp).toBe(T1_HLC);
        expect(row2!.hlc_timestamp).toBe(T2_HLC);
        expect(row3!.hlc_timestamp).toBe(T3_HLC);

        // 3. Verify Event Types
        expect(row1!.mutation_type).toBe("createBlock");
        expect(row2!.mutation_type).toBe("updateBlock");
        expect(row3!.mutation_type).toBe("revertBlock");

        // 4. Verify Immutability of "Bad" Record (Row 2)
        // It should NOT be marked as rejected.
        expect(row2!.was_rejected).toBe(false); 
        const badDelta = typeof row2!.change_delta === 'string' ? JSON.parse(row2!.change_delta) : row2!.change_delta;
        
        expect((badDelta as { fields: { value: number } }).fields.value).toBe(9999); 

        // 5. Verify Causal Linking in Correction (Row 3)
        // The revert event should contain metadata linking it to the history ID it restored.
        const correctionDelta = typeof row3!.change_delta === 'string' ? JSON.parse(row3!.change_delta) : row3!.change_delta;
        
        expect((correctionDelta as { revertedFromHistoryId: string }).revertedFromHistoryId).toBe(t1History.id);

        // 6. Verify Final State (Current Truth)
        const finalBlock = yield* Effect.promise(() => 
            db.selectFrom("block").selectAll().where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        
        const finalFields = finalBlock.fields as { value: number };
        expect(finalFields.value).toBe(100); // Restored to Safe
        expect(finalBlock.global_version).toBe(T3_HLC);
        expect(finalBlock.version).toBe(3); // Version incremented linearly (1->2->3)
      })
    );
  });
});
