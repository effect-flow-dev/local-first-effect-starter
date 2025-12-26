// FILE: src/lib/server/LinkService.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { Effect } from "effect";
import { updateLinksForNote } from "./LinkService";
import type { UserId, NoteId } from "../shared/schemas";

const VALID_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as UserId;
const CURRENT_NOTE_ID = "00000000-0000-0000-0000-000000000001" as NoteId;
const TARGET_NOTE_ID_A = "00000000-0000-0000-0000-00000000000A" as NoteId;
const TARGET_NOTE_ID_B = "00000000-0000-0000-0000-00000000000B" as NoteId;

// --- Mocks ---
const { mockDb, mockDeleteExecute, mockInsertExecute, mockSelectExecute } = vi.hoisted(() => {
  const mockInsertExecute = vi.fn();
  const mockDeleteExecute = vi.fn();
  const mockSelectExecute = vi.fn();

  const mockDb = {
    deleteFrom: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      execute: mockDeleteExecute,
    })),
    selectFrom: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      execute: mockSelectExecute,
    })),
    insertInto: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      execute: mockInsertExecute,
    })),
  } as any;

  return { mockDb, mockDeleteExecute, mockInsertExecute, mockSelectExecute };
});

describe("LinkService (Unit)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should clear existing links and exit if no blocks exist", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        mockDeleteExecute.mockResolvedValue(undefined);
        
        // 1. Fetch Blocks -> Empty
        mockSelectExecute.mockResolvedValueOnce([]);
        
        // 2. Fetch Existing Links -> Return some "stale" links that need deleting
        mockSelectExecute.mockResolvedValueOnce([
            { source_block_id: "stale-block-id", target_note_id: "stale-target-id" }
        ]);

        yield* updateLinksForNote(mockDb, CURRENT_NOTE_ID, VALID_USER_ID);

        expect(mockDb.deleteFrom).toHaveBeenCalledWith("link");
        expect(mockDb.selectFrom).toHaveBeenCalledWith("block");
        expect(mockDb.insertInto).not.toHaveBeenCalled();
      }),
    );
  });

  it("should parse [[WikiLinks]], resolve them, and insert new links", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const blocks = [
          { id: "block-1", content: "This is a link to [[Target Note A]]." },
          { id: "block-2", content: "Links to [[Target Note B]] and [[Target Note A]] again." },
          { id: "block-3", content: "No links here." },
        ];
        const resolvedNotes = [
          { id: TARGET_NOTE_ID_A, title: "Target Note A" },
          { id: TARGET_NOTE_ID_B, title: "Target Note B" },
        ];

        mockDeleteExecute.mockResolvedValue(undefined);
        // 1. Get Blocks
        mockSelectExecute.mockResolvedValueOnce(blocks);
        // 2. Resolve Notes
        mockSelectExecute.mockResolvedValueOnce(resolvedNotes);
        // 3. Get Existing Links -> Empty (so we insert new ones)
        mockSelectExecute.mockResolvedValueOnce([]);
        
        mockInsertExecute.mockResolvedValue(undefined);

        yield* updateLinksForNote(mockDb, CURRENT_NOTE_ID, VALID_USER_ID);

        expect(mockDb.insertInto).toHaveBeenCalledWith("link");
      }),
    );
  });

  it("should ignore links to notes that do not exist", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const blocks = [{ id: "block-1", content: "This links to [[Non-existent Note]]." }];

        mockDeleteExecute.mockResolvedValue(undefined);
        // 1. Get Blocks
        mockSelectExecute.mockResolvedValueOnce(blocks);
        // 2. Resolve Notes -> Empty (Note not found)
        mockSelectExecute.mockResolvedValueOnce([]); 
        // 3. Get Existing Links -> Empty
        mockSelectExecute.mockResolvedValueOnce([]); 

        yield* updateLinksForNote(mockDb, CURRENT_NOTE_ID, VALID_USER_ID);

        expect(mockDb.insertInto).not.toHaveBeenCalled();
      }),
    );
  });
});
