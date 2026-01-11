// File: src/features/note/note.mutations.block.test.ts
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
  fn: {
      max: vi.fn().mockReturnValue({ as: vi.fn().mockReturnThis() })
  }
} as any;

vi.mock("../replicache/versioning", () => ({
  getNextGlobalVersion: vi.fn(() => Effect.succeed(100))
}));

// Mock history utils to avoid DB calls
vi.mock("./history.utils", () => ({
    logBlockHistory: vi.fn(() => Effect.succeed("history-1")),
    markHistoryRejected: vi.fn(() => Effect.succeed(undefined))
}));

describe("handleUpdateBlock Mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirstOrThrow.mockResolvedValue({ id: "history-1" });
    mockExecuteTakeFirst.mockResolvedValue(undefined);
  });

  it("correctly merges new fields into existing block attributes in Note content", async () => {
    // 1. Mock Block Lookup (Resolving note_id and current version)
    mockExecuteTakeFirst.mockResolvedValueOnce({ 
        note_id: NOTE_ID, 
        version: 1, 
        type: "interactiveBlock", 
        fields: { caption: "Existing", width: 500 } 
    });
    
    // 2. Mock Note Lookup (Fetching the Prosemirror tree)
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

    // 3. Execute Mutation
    await Effect.runPromise(
      handleUpdateBlock(
        mockDb, 
        { 
          blockId: BLOCK_ID, 
          fields: { width: 600 },
          version: 1 
        }, 
        USER_ID,
        "1000:0000:TEST" 
      )
    );

    // 4. Verification
    expect(mockDb.updateTable).toHaveBeenCalledWith("note");
    expect(mockDb.updateTable).toHaveBeenCalledWith("block");
    
    const setCalls = mockQueryBuilder.set.mock.calls;
    
    // Find the call that updates note content
    // ✅ FIXED: We must parse the stringified JSON from the mock arguments
    const noteUpdateArgs = setCalls.find((args: any[]) => args[0].content)?.[0];
    expect(noteUpdateArgs).toBeDefined();
    
    const parsedContent = JSON.parse(noteUpdateArgs.content);
    expect(parsedContent.content[0].attrs.fields.width).toBe(600);
    expect(parsedContent.content[0].attrs.fields.caption).toBe("Existing");
    
    expect(noteUpdateArgs.global_version).toBe("1000:0000:TEST");
  });

  it("is idempotent if the block record does not exist (note lookup fails)", async () => {
    // 1. Resolve Block -> Returns undefined (Block not found)
    mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

    await Effect.runPromise(
      handleUpdateBlock(mockDb, { 
          blockId: BLOCK_ID, 
          fields: { foo: "bar" },
          version: 1 
      }, USER_ID, "2000:0000:TEST") 
    );

    expect(mockDb.selectFrom).toHaveBeenCalledWith("block");
    // Should exit early and not perform any updates
    expect(mockDb.updateTable).not.toHaveBeenCalled();
  });
});
