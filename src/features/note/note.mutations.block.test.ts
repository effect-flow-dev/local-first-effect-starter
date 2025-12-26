// FILE: src/features/note/note.mutations.block.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { handleUpdateBlock } from "./note.mutations";
import type { UserId, BlockId, NoteId } from "../../lib/shared/schemas";

const USER_ID = "user-1" as UserId;
const NOTE_ID = "note-1" as NoteId;
const BLOCK_ID = "block-1" as BlockId;

// --- Mocks ---
const mockExecute = vi.fn().mockResolvedValue([]);
const mockExecuteTakeFirst = vi.fn().mockResolvedValue(undefined);
const mockExecuteTakeFirstOrThrow = vi.fn().mockResolvedValue({ id: "history-1" });

const mockQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  selectFrom: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  updateTable: vi.fn().mockReturnThis(),
  insertInto: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(), // ✅ Added
  execute: mockExecute,
  executeTakeFirst: mockExecuteTakeFirst,
  executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
};

const mockDb = {
  selectFrom: vi.fn().mockReturnValue(mockQueryBuilder),
  updateTable: vi.fn().mockReturnValue(mockQueryBuilder),
  insertInto: vi.fn().mockReturnValue(mockQueryBuilder),
} as any;

vi.mock("../replicache/versioning", () => ({
  getNextGlobalVersion: vi.fn(() => Effect.succeed(100))
}));

describe("handleUpdateBlock Mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue([]);
    // Default audit log success
    mockExecuteTakeFirstOrThrow.mockResolvedValue({ id: "history-1" });
    // Default: No block found initially unless specified
    mockExecuteTakeFirst.mockResolvedValue(undefined);
  });

  it("correctly merges new fields into existing block attributes in Note content", async () => {
    // 1. Resolve Block (selectFrom block)
    mockExecuteTakeFirst.mockResolvedValueOnce({ note_id: NOTE_ID, version: 1 });
    
    // 2. Check Recent History (selectFrom block_history) -> undefined (new session)
    mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

    // 3. Note Content (selectFrom note)
    const existingContent = {
      type: "doc",
      content: [
        {
          type: "interactiveBlock",
          attrs: {
            blockId: BLOCK_ID,
            version: 1,
            fields: { caption: "Existing", width: 500 },
          },
        },
      ],
    };
    mockExecuteTakeFirst.mockResolvedValueOnce({ id: NOTE_ID, content: existingContent });

    // 4. Updates
    mockExecute.mockResolvedValueOnce([{ updated_at: new Date() }]); // Note Update
    mockExecute.mockResolvedValueOnce([]); // Block Update

    await Effect.runPromise(
      handleUpdateBlock(
        mockDb, 
        { 
          blockId: BLOCK_ID, 
          fields: { width: 600 },
          version: 1 
        }, 
        USER_ID
      )
    );

    // Verify calls
    expect(mockDb.updateTable).toHaveBeenCalledWith("note");
    
    const setCalls = mockQueryBuilder.set.mock.calls;
    // Find the call that updates content (the Note update)
    const noteUpdateArgs = setCalls.find((args: any[]) => args[0].content)?.[0];
    
    expect(noteUpdateArgs).toBeDefined();
    expect(noteUpdateArgs.content.content[0].attrs.fields.width).toBe(600);
    expect(noteUpdateArgs.global_version).toBe("100");
  });

  it("is idempotent if the block record does not exist (note lookup fails)", async () => {
    // 1. Resolve Block -> returns undefined (Not Found)
    mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

    await Effect.runPromise(
      handleUpdateBlock(mockDb, { 
          blockId: BLOCK_ID, 
          fields: { foo: "bar" },
          version: 1 
      }, USER_ID)
    );

    // It should try to select the block
    expect(mockDb.selectFrom).toHaveBeenCalledWith("block");
    
    // But since it wasn't found, it shouldn't try to update anything
    expect(mockDb.updateTable).not.toHaveBeenCalled();
  });
});
