// FILE: src/features/note/note.sync.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { Effect, Either } from "effect";
import { noteSyncHandler } from "./note.sync";
import { NoteDatabaseError } from "./Errors";
import type { UserId, NoteId } from "../../lib/shared/schemas";
import type { TiptapDoc } from "../../lib/shared/schemas";

// --- Constants ---
const USER_ID = "user-1" as UserId;
const NOTE_ID_1 = "note-1" as NoteId;
const VALID_CONTENT: TiptapDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

// --- Mock Factory ---
const makeMockTrx = (opts: {
  changedNotes?: Array<any>;
  deletedNotes?: Array<any>;
  shouldFail?: boolean;
}) => {
  const execute = vi.fn();

  const queryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: execute,
  };

  const trx: any = {
    selectFrom: vi.fn().mockReturnValue(queryBuilder),
  };

  execute.mockImplementation(async () => {
    if (opts.shouldFail) {
      throw new Error("DB Connection Failed");
    }
    // Simplistic mock routing based on table name in calls
    const table = trx.selectFrom.mock.calls[trx.selectFrom.mock.calls.length - 1]?.[0];
    
    if (table === "note") {
      return opts.changedNotes || [];
    }
    if (table === "tombstone") {
      return opts.deletedNotes || [];
    }
    return [];
  });

  return { trx };
};

describe("noteSyncHandler (Delta)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("generates 'put' operations for notes with global_version > sinceVersion", async () => {
    const { trx } = makeMockTrx({
      changedNotes: [
        {
          id: NOTE_ID_1,
          user_id: USER_ID,
          title: "Delta Updated",
          content: VALID_CONTENT,
          version: 5,
          global_version: 105, // > 100
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      deletedNotes: []
    });

    const sinceVersion = 100;
    const result = await Effect.runPromise(
      noteSyncHandler.getPatchOperations(
        trx,
        USER_ID,
        sinceVersion
      )
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      op: "put",
      key: `note/${NOTE_ID_1}`,
      value: expect.objectContaining({
        title: "Delta Updated",
      }),
    });
    
    // Verify Query Structure
    expect(trx.selectFrom).toHaveBeenCalledWith("note");
    // Ensure we filter by global_version
    // Note: Vitest args checking might require inspecting calls deeper if using complex builders
  });

  it("generates 'del' operations for tombstones with deleted_at_version > sinceVersion", async () => {
    const { trx } = makeMockTrx({
      changedNotes: [],
      deletedNotes: [
        { entity_id: "deleted-note-id" }
      ]
    });

    const sinceVersion = 100;
    const result = await Effect.runPromise(
      noteSyncHandler.getPatchOperations(
        trx,
        USER_ID,
        sinceVersion
      )
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      op: "del",
      key: `note/deleted-note-id`
    });
    
    expect(trx.selectFrom).toHaveBeenCalledWith("tombstone");
  });

  it("returns NoteDatabaseError on DB failure", async () => {
    const { trx } = makeMockTrx({ shouldFail: true });

    const result = await Effect.runPromise(
      Effect.either(
        noteSyncHandler.getPatchOperations(trx, USER_ID, 0)
      )
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(NoteDatabaseError);
    }
  });
});
