// FILE: src/features/note/note.mutations.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { handleCreateNote, handleUpdateNote } from "./note.mutations";
import type { UserId, NoteId } from "../../lib/shared/schemas";
import { NoteTitleExistsError } from "../../lib/shared/errors";

const VALID_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as UserId;
const VALID_NOTE_ID = "00000000-0000-0000-0000-000000000001" as NoteId;
const OTHER_NOTE_ID = "00000000-0000-0000-0000-000000000002" as NoteId;

// --- Mocks ---
const { mockUpdateLinksForNote, mockSyncTasksForNote, mockGetNextGlobalVersion, mockDb, mockQueryBuilder, mockExecute, mockExecuteTakeFirst, mockExecuteTakeFirstOrThrow } = vi.hoisted(() => {
  const mockUpdateLinksForNote = vi.fn(() => Effect.void);
  const mockSyncTasksForNote = vi.fn(() => Effect.void);
  const mockGetNextGlobalVersion = vi.fn(() => Effect.succeed(100)); 
  
  const mockExecute = vi.fn();
  const mockExecuteTakeFirst = vi.fn();
  const mockExecuteTakeFirstOrThrow = vi.fn();

  const mockQueryBuilder = {
    select: vi.fn().mockReturnThis(),
    selectFrom: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    updateTable: vi.fn().mockReturnThis(),
    deleteFrom: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    doUpdateSet: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(), // ✅ Added orderBy
    limit: vi.fn().mockReturnThis(), // ✅ Added limit
    execute: mockExecute,
    executeTakeFirst: mockExecuteTakeFirst,
    executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
  };

  const mockDb = {
    selectFrom: vi.fn().mockReturnValue(mockQueryBuilder),
    insertInto: vi.fn().mockReturnValue(mockQueryBuilder),
    updateTable: vi.fn().mockReturnValue(mockQueryBuilder),
    deleteFrom: vi.fn().mockReturnValue(mockQueryBuilder),
    transaction: vi.fn().mockReturnValue({
      execute: async (callback: any) => callback(mockDb),
    }),
  } as any;

  return { mockUpdateLinksForNote, mockSyncTasksForNote, mockGetNextGlobalVersion, mockDb, mockQueryBuilder, mockExecute, mockExecuteTakeFirst, mockExecuteTakeFirstOrThrow };
});

vi.mock("../../lib/server/LinkService", () => ({
  updateLinksForNote: mockUpdateLinksForNote,
}));

vi.mock("../../lib/server/TaskService", () => ({
  syncTasksForNote: mockSyncTasksForNote,
}));

vi.mock("../replicache/versioning", () => ({
  getNextGlobalVersion: mockGetNextGlobalVersion
}));

// Mock Kysely SQL
vi.mock("kysely", async (importOriginal) => {
  const actual = await importOriginal<typeof import("kysely")>();
  return {
    ...actual,
    sql: Object.assign((strings: any, ...values: any[]) => ({
      execute: () => Promise.resolve(),
    }), {
        ref: actual.sql.ref,
        raw: () => ({ execute: () => Promise.resolve() }), 
        join: actual.sql.join
    })
  };
});

describe("Note Mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default: Return a dummy history ID for executeTakeFirstOrThrow
    mockExecuteTakeFirstOrThrow.mockResolvedValue({ id: "mock-history-id" });
    
    // Default: Return empty array for generic execute
    mockExecute.mockResolvedValue([]); 
    
    // Default: Return undefined for generic executeTakeFirst (e.g. check duplicate title, check recent history)
    mockExecuteTakeFirst.mockResolvedValue(undefined);
  });

  describe("handleCreateNote", () => {
    it("creates a note with the exact title if no duplicate exists", async () => {
      // 1. Check recent history (returns undefined -> new entry)
      // 2. Check title duplicate (returns undefined -> safe)
      // 3. Insert history (executeTakeFirstOrThrow -> success)
      
      mockExecuteTakeFirst.mockResolvedValue(undefined);
      
      await Effect.runPromise(
        handleCreateNote(mockDb, {
          id: VALID_NOTE_ID,
          userID: VALID_USER_ID,
          title: "My Note",
        }),
      );

      expect(mockDb.insertInto).toHaveBeenCalledWith("note");
      expect(mockQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({ title: "My Note", global_version: "100" }),
      );
    });

    it("appends (2) if title already exists", async () => {
      // 1. Check recent history -> undefined
      // 2. Check duplicate title -> found "existing"
      // 3. Check duplicate title (2) -> undefined
      
      mockExecuteTakeFirst
        .mockResolvedValueOnce(undefined) // History check
        .mockResolvedValueOnce({ id: "existing" }) // First title check
        .mockResolvedValueOnce(undefined); // Second title check

      await Effect.runPromise(
        handleCreateNote(mockDb, {
          id: VALID_NOTE_ID,
          userID: VALID_USER_ID,
          title: "My Note",
        }),
      );

      expect(mockQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({ title: "My Note (2)" }),
      );
    });
  });

  describe("handleUpdateNote", () => {
    it("parses Tiptap JSON into Blocks and syncs services", async () => {
      // 1. Check recent history (for session merge) -> undefined
      // 2. Insert Block History -> success
      // 3. Check duplicate title -> undefined (safe)
      // 4. Update Note (updateTable note) -> return updated row
      
      mockExecuteTakeFirst.mockResolvedValue(undefined);
      mockExecuteTakeFirstOrThrow.mockResolvedValue({ id: "history-id" });

      mockExecute.mockImplementation((...args) => {
          return Promise.resolve([{ updated_at: new Date() }]);
      });

      const complexContent = {
        type: "doc" as const,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hello" }] }
        ],
      };

      await Effect.runPromise(
        handleUpdateNote(
          mockDb,
          {
            id: VALID_NOTE_ID,
            title: "Updated Title",
            // @ts-expect-error Tiptap type compat
            content: complexContent,
          },
          VALID_USER_ID,
        ),
      );

      expect(mockDb.updateTable).toHaveBeenCalledWith("note");
      expect(mockDb.insertInto).toHaveBeenCalledWith("block");
      expect(mockDb.deleteFrom).toHaveBeenCalledWith("block");
    });

    it("fails if renaming to a title that exists on ANOTHER note", async () => {
      // 1. Check recent history -> undefined
      // 2. Insert Block History -> success
      // 3. Check duplicate title -> found collision!
      
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // History
      mockExecuteTakeFirst.mockResolvedValueOnce({ id: OTHER_NOTE_ID }); // Collision check

      const result = await Effect.runPromise(
        Effect.either(
          handleUpdateNote(
            mockDb,
            {
              id: VALID_NOTE_ID,
              title: "Existing Title",
              content: { type: "doc", content: [] } as any,
            },
            VALID_USER_ID,
          ),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(NoteTitleExistsError);
      }
    });
  });
});
