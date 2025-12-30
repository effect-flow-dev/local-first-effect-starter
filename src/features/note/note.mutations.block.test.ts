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
  orderBy: vi.fn().mockReturnThis(),
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
    mockExecuteTakeFirstOrThrow.mockResolvedValue({ id: "history-1" });
    mockExecuteTakeFirst.mockResolvedValue(undefined);
  });

  it("correctly merges new fields into existing block attributes in Note content", async () => {
    // Flow:
    // 1. Resolve Block (selectFrom block) -> Returns info
    // 2. logBlockHistory (insertInto block_history)
    // 3. Resolve Note (selectFrom note) -> Returns content
    // 4. Update Note (updateTable note)
    // 5. Update Block (updateTable block)

    // 1. Block Lookup
    mockExecuteTakeFirst.mockResolvedValueOnce({ note_id: NOTE_ID, version: 1, type: "interactiveBlock", fields: {} });
    
    // 2. History (mockExecuteTakeFirstOrThrow handles this, does not consume from mockExecuteTakeFirst stack)

    // 3. Note Lookup
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

    // 4. Update Note Execution
    mockExecute.mockResolvedValueOnce([]); 

    // 5. Update Block Execution
    mockExecute.mockResolvedValueOnce([]);

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

    // Verify updates
    expect(mockDb.updateTable).toHaveBeenCalledWith("note");
    expect(mockDb.updateTable).toHaveBeenCalledWith("block");
    
    // Check Note Update Content
    const setCalls = mockQueryBuilder.set.mock.calls;
    // Find the call that updates content (the Note update)
    const noteUpdateArgs = setCalls.find((args: any[]) => args[0].content)?.[0];
    
    expect(noteUpdateArgs).toBeDefined();
    expect(noteUpdateArgs.content.content[0].attrs.fields.width).toBe(600);
    expect(noteUpdateArgs.global_version).toBe("100");
  });

  it("is idempotent if the block record does not exist (note lookup fails)", async () => {
    // 1. Resolve Block -> Returns undefined
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
    
    // It should NOT proceed to update tables
    expect(mockDb.updateTable).not.toHaveBeenCalled();
    expect(mockDb.insertInto).not.toHaveBeenCalled(); // No history created
  });
});
