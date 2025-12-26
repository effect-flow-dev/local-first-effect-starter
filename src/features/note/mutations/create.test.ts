// FILE: src/features/note/mutations/create.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { handleCreateNote } from "./create";
import type { UserId, NoteId } from "../../../lib/shared/schemas";

const USER_ID = "user-1" as UserId;
const NOTE_ID = "note-1" as NoteId;

// --- Mocks ---
const { mockDb, mockInsertInto } = vi.hoisted(() => {
  const mockInsertInto = vi.fn().mockReturnThis();
  const mockValues = vi.fn().mockReturnThis();
  const mockExecute = vi.fn().mockResolvedValue([]);
  
  const mockDb = {
    selectFrom: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(undefined)
        })
      })
    }),
    insertInto: mockInsertInto,
    values: mockValues,
    execute: mockExecute
  } as any;
  
  mockInsertInto.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ execute: mockExecute });

  return { mockDb, mockInsertInto };
});

vi.mock("../../replicache/versioning", () => ({
  getNextGlobalVersion: vi.fn(() => Effect.succeed(100))
}));

vi.mock("../history.utils", () => ({
  logBlockHistory: vi.fn(() => Effect.void)
}));

describe("handleCreateNote (Type & Logic Check)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute insert without type errors", async () => {
    await Effect.runPromise(
      handleCreateNote(mockDb, {
        id: NOTE_ID,
        userID: USER_ID,
        title: "Test Note",
        template: []
      })
    );

    expect(mockDb.insertInto).toHaveBeenCalledWith("note");
  });
});
