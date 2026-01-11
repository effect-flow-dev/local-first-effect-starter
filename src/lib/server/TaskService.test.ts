// FILE: src/lib/server/TaskService.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { Effect } from "effect";
import { syncTasksForNote } from "./TaskService";
import type { UserId, NoteId } from "../shared/schemas";

const VALID_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as UserId;
const NOTE_ID = "00000000-0000-0000-0000-000000000001" as NoteId;
const TEST_HLC = "1736612345000:0001:TEST";

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
      execute: mockSelectExecute,
    })),
    insertInto: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      execute: mockInsertExecute,
    })),
  } as any;

  return { mockDb, mockDeleteExecute, mockInsertExecute, mockSelectExecute };
});

describe("TaskService (Unit)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should clear existing tasks and insert nothing if no blocks match task regex", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const blocks = [
          { id: "block-1", content: "Just a paragraph." },
          { id: "block-2", content: "Another line." },
        ];

        mockDeleteExecute.mockResolvedValue(undefined);
        mockSelectExecute.mockResolvedValue(blocks);

        // ✅ FIXED: Added TEST_HLC argument
        yield* syncTasksForNote(mockDb, NOTE_ID, VALID_USER_ID, TEST_HLC);

        expect(mockDb.deleteFrom).toHaveBeenCalledWith("task");
        expect(mockDb.insertInto).not.toHaveBeenCalled();
      }),
    );
  });

  it("should identify incomplete tasks '- [ ] ...'", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const blocks = [{ id: "block-1", content: "- [ ] Buy milk" }];

        mockDeleteExecute.mockResolvedValue(undefined);
        mockSelectExecute.mockResolvedValue(blocks);
        mockInsertExecute.mockResolvedValue(undefined);

        // ✅ FIXED: Added TEST_HLC argument
        yield* syncTasksForNote(mockDb, NOTE_ID, VALID_USER_ID, TEST_HLC);

        expect(mockDb.insertInto).toHaveBeenCalledWith("task");

        const insertResult = mockDb.insertInto.mock.results[0];
        const insertCall = insertResult.value;
        const insertedTasks = insertCall.values.mock.calls[0][0];

        expect(insertedTasks[0]).toEqual(
          expect.objectContaining({
            user_id: VALID_USER_ID,
            source_block_id: "block-1",
            content: "Buy milk",
            is_complete: false,
          }),
        );
      }),
    );
  });

  it("should identify complete tasks '- [x] ...'", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const blocks = [{ id: "block-2", content: "- [x] Finished task" }];

        mockDeleteExecute.mockResolvedValue(undefined);
        mockSelectExecute.mockResolvedValue(blocks);
        mockInsertExecute.mockResolvedValue(undefined);

        // ✅ FIXED: Added TEST_HLC argument
        yield* syncTasksForNote(mockDb, NOTE_ID, VALID_USER_ID, TEST_HLC);

        const insertResult = mockDb.insertInto.mock.results[0];
        const insertCall = insertResult.value;
        const insertedTasks = insertCall.values.mock.calls[0][0];

        expect(insertedTasks[0]).toEqual(
          expect.objectContaining({
            source_block_id: "block-2",
            content: "Finished task",
            is_complete: true,
          }),
        );
      }),
    );
  });
});
