// File: ./src/features/note/note.mutations.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { handleCreateNote } from "./note.mutations";
import type { UserId, NoteId } from "../../lib/shared/schemas";

const VALID_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as UserId;
const VALID_NOTE_ID = "00000000-0000-0000-0000-000000000001" as NoteId;

const { 
  mockDb, 
  mockExecute, 
  mockExecuteTakeFirst, 
  mockExecuteTakeFirstOrThrow,
  mockUpdateLinksForNote, 
  mockSyncTasksForNote, 
  mockGetNextGlobalVersion 
} = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const mockExecuteTakeFirst = vi.fn();
  const mockExecuteTakeFirstOrThrow = vi.fn();

  const mockQueryBuilder = new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined; 
      if (prop === 'execute') return mockExecute;
      if (prop === 'executeTakeFirst') return mockExecuteTakeFirst;
      if (prop === 'executeTakeFirstOrThrow') return mockExecuteTakeFirstOrThrow;
      return () => mockQueryBuilder;
    }
  });

  const mockDb = {
    selectFrom: vi.fn().mockReturnValue(mockQueryBuilder),
    insertInto: vi.fn().mockReturnValue(mockQueryBuilder),
    updateTable: vi.fn().mockReturnValue(mockQueryBuilder),
    deleteFrom: vi.fn().mockReturnValue(mockQueryBuilder),
    transaction: vi.fn(), 
    fn: {
        max: vi.fn().mockReturnValue({ as: vi.fn() })
    }
  } as any;

  return { 
    mockDb, 
    mockExecute, 
    mockExecuteTakeFirst, 
    mockExecuteTakeFirstOrThrow,
    mockUpdateLinksForNote: vi.fn(() => Effect.void),
    mockSyncTasksForNote: vi.fn(() => Effect.void),
    mockGetNextGlobalVersion: vi.fn(() => Effect.succeed(100))
  };
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

vi.mock("./history.utils", async () => {
  const { Effect } = await import("effect");
  return {
    logBlockHistory: vi.fn(() => Effect.void),
    markHistoryRejected: vi.fn(() => Effect.void)
  };
});

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
    mockDb.transaction.mockReturnValue({
        execute: async (callback: any) => callback(mockDb)
    });
    mockExecute.mockResolvedValue([]); 
    mockExecuteTakeFirst.mockResolvedValue(undefined);
    mockExecuteTakeFirstOrThrow.mockResolvedValue({ id: "mock-history-id" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handleCreateNote", () => {
    it("creates a note with the exact title if no duplicate exists", async () => {
      await Effect.runPromise(
        handleCreateNote(mockDb, {
          id: VALID_NOTE_ID,
          userID: VALID_USER_ID,
          title: "My Note",
        }, "1736612345678:0001:TEST_NODE"),
      );

      expect(mockDb.insertInto).toHaveBeenCalledWith("note");
    });
  });
});
