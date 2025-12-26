// FILE: src/features/replicache/push.handler.test.ts
import { vi, describe, it, expect, afterEach } from "vitest";
import { Effect, Either } from "effect";
import { handlePush } from "./push";
import type { User, UserId } from "../../lib/shared/schemas";
import type { PushRequest } from "../../lib/shared/replicache-schemas";

// --- MOCKS ---
const {
  handleCreateNote,
  handleUpdateNote,
  handleDeleteNote,
  handleUpdateTask,
} = vi.hoisted(() => ({
  handleCreateNote: vi.fn(() => Effect.void),
  handleUpdateNote: vi.fn(() => Effect.void),
  handleDeleteNote: vi.fn(() => Effect.void),
  handleUpdateTask: vi.fn(() => Effect.void),
}));

vi.mock("../note/note.mutations.ts", async () => {
  const actual = await vi.importActual<typeof import("../note/note.mutations.ts")>("../note/note.mutations.ts");
  return {
    ...actual,
    handleCreateNote,
    handleUpdateNote,
    handleDeleteNote,
    handleUpdateTask,
  };
});

const { mockPoke } = vi.hoisted(() => ({
  mockPoke: vi.fn(() => Effect.void),
}));

vi.mock("../../lib/server/PokeService", () => ({
  poke: mockPoke,
}));

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

const { mockDb, mockExecuteTakeFirst } = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const mockExecuteTakeFirst = vi.fn();
  const mockExecuteTakeFirstOrThrow = vi.fn();

  const mockQueryBuilder = {
    selectAll: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returningAll: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    column: vi.fn().mockReturnThis(),
    doNothing: vi.fn().mockReturnThis(),
    execute: mockExecute,
    executeTakeFirst: mockExecuteTakeFirst,
    executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
  };

  const mockTrx = {
    selectFrom: vi.fn().mockReturnValue(mockQueryBuilder),
    updateTable: vi.fn().mockReturnValue(mockQueryBuilder),
    insertInto: vi.fn().mockReturnValue(mockQueryBuilder),
  };

  const mockDb = {
    transaction: vi.fn(() => ({
      execute: (fn: (trx: any) => any) => fn(mockTrx),
    })),
  } as any;

  return { mockDb, mockExecute, mockExecuteTakeFirst, mockExecuteTakeFirstOrThrow, mockTrx };
});

const mockUser: User = {
  id: "u1" as UserId,
  email: "test@example.com",
  password_hash: "pw",
  email_verified: true,
  created_at: new Date(),
  avatar_url: null,
  permissions: [],
  // ✅ FIX: Removed tenant_strategy, database_name, subdomain (now in Tenant table)
};

const mockBasePushRequest: PushRequest = {
  clientGroupID: "cg1",
  mutations: [],
};

// Use valid UUIDs for testing schema validation
const VALID_NOTE_UUID = "00000000-0000-0000-0000-000000000001";
const VALID_USER_UUID = "00000000-0000-0000-0000-000000000002";

describe("Replicache: handlePush", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("given a valid createNote mutation, it correctly inserts the note", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        // Mock Client State Retrieval (Initial: 0)
        mockExecuteTakeFirst.mockResolvedValueOnce({
          id: "client1",
          client_group_id: "cg1",
          last_mutation_id: 0,
        });

        const req: PushRequest = {
          ...mockBasePushRequest,
          mutations: [
            {
              id: 1,
              name: "createNote",
              args: { id: VALID_NOTE_UUID, userID: VALID_USER_UUID, title: "New Note" },
              clientID: "client1",
            },
          ],
        };

        // ✅ FIX: Added "OWNER" as the currentRole argument
        const result = yield* Effect.either(handlePush(req, mockUser, mockDb, "OWNER"));

        expect(Either.isRight(result)).toBe(true);
        expect(handleCreateNote).toHaveBeenCalledTimes(1);
      }),
    );
  });

  it("given a mutation that has already been processed, it ignores it", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        // Client already at mutation 1
        mockExecuteTakeFirst.mockResolvedValueOnce({ 
            id: "client1",
            client_group_id: "cg1",
            last_mutation_id: 1 
        });

        const req: PushRequest = {
          ...mockBasePushRequest,
          mutations: [{ id: 1, name: "createNote", args: { id: VALID_NOTE_UUID, userID: VALID_USER_UUID, title: "Dupe" }, clientID: "client1" }],
        };

        // ✅ FIX: Added "OWNER" as the currentRole argument
        const result = yield* Effect.either(handlePush(req, mockUser, mockDb, "OWNER"));

        expect(Either.isRight(result)).toBe(true);
        expect(handleCreateNote).not.toHaveBeenCalled();
      }),
    );
  });
});
