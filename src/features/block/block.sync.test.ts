// FILE: src/features/block/block.sync.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { Effect } from "effect";
import { blockSyncHandler } from "./block.sync";
import type { UserId, BlockId, NoteId } from "../../lib/shared/schemas";

const USER_ID = "user-1" as UserId;
const BLOCK_ID = "block-1" as BlockId;
const NOTE_ID = "note-1" as NoteId;

const makeMockTrx = (opts: {
  changedBlocks?: Array<any>;
  deletedBlocks?: Array<any>;
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
    const table = trx.selectFrom.mock.calls[trx.selectFrom.mock.calls.length - 1]?.[0];
    if (table === "block") return opts.changedBlocks || [];
    if (table === "tombstone") return opts.deletedBlocks || [];
    return [];
  });

  return { trx };
};

describe("blockSyncHandler (Delta)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("generates 'put' for blocks with global_version > sinceVersion", async () => {
    const { trx } = makeMockTrx({
      changedBlocks: [
        {
          id: BLOCK_ID,
          user_id: USER_ID,
          note_id: NOTE_ID,
          type: "text",
          content: "Delta Content",
          fields: {},
          tags: [],
          links: [],
          file_path: "",
          parent_id: null,
          depth: 0,
          order: 0,
          transclusions: [],
          version: 2,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });

    const result = await Effect.runPromise(
      blockSyncHandler.getPatchOperations(
        trx,
        USER_ID,
        50 // sinceVersion
      )
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
        op: "put",
        key: `block/${BLOCK_ID}`,
    }));
  });

  it("generates 'del' for blocks in tombstone table since version", async () => {
    const { trx } = makeMockTrx({
        changedBlocks: [],
        deletedBlocks: [{ entity_id: "old-block" }]
    });

    const result = await Effect.runPromise(
        blockSyncHandler.getPatchOperations(
          trx,
          USER_ID,
          50
        )
      );
  
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
          op: "del",
          key: `block/old-block`,
      });
  });
});
