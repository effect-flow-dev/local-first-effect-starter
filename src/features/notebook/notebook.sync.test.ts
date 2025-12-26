// FILE: src/features/notebook/notebook.sync.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { Effect, Either } from "effect";
import { notebookSyncHandler } from "./notebook.sync";
import { NotebookDatabaseError } from "./Errors";
import type { UserId, NotebookId } from "../../lib/shared/schemas";

const USER_ID = "user-1" as UserId;
const NB_ID = "nb-1" as NotebookId;

const makeMockTrx = (opts: {
  changedNotebooks?: Array<any>;
  deletedNotebooks?: Array<any>;
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
    if (opts.shouldFail) throw new Error("DB Fail");
    
    const table = trx.selectFrom.mock.calls[trx.selectFrom.mock.calls.length - 1]?.[0];
    if (table === "notebook") return opts.changedNotebooks || [];
    if (table === "tombstone") return opts.deletedNotebooks || [];
    return [];
  });

  return { trx };
};

describe("notebookSyncHandler (Delta)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("generates 'put' for notebooks with global_version > sinceVersion", async () => {
    const { trx } = makeMockTrx({
      changedNotebooks: [
        {
          id: NB_ID,
          user_id: USER_ID,
          name: "Project X",
          created_at: new Date("2025-01-01"),
          global_version: 150,
        },
      ],
    });

    const result = await Effect.runPromise(
      notebookSyncHandler.getPatchOperations(trx, USER_ID, 100)
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      op: "put",
      key: `notebook/${NB_ID}`,
      value: {
        _tag: "notebook",
        id: NB_ID,
        user_id: USER_ID,
        name: "Project X",
        created_at: "2025-01-01T00:00:00.000Z",
        global_version: "150",
      },
    });
  });

  it("generates 'del' for deleted notebooks (tombstones)", async () => {
    const { trx } = makeMockTrx({
      deletedNotebooks: [{ entity_id: "nb-old" }],
    });

    const result = await Effect.runPromise(
      notebookSyncHandler.getPatchOperations(trx, USER_ID, 100)
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      op: "del",
      key: `notebook/nb-old`,
    });
  });

  it("handles DB errors gracefully", async () => {
    const { trx } = makeMockTrx({ shouldFail: true });

    // Use Effect.either to capture the error as a value (Left) instead of a Promise rejection
    const result = await Effect.runPromise(
        Effect.either(notebookSyncHandler.getPatchOperations(trx, USER_ID, 0))
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(NotebookDatabaseError);
    }
  });
});
