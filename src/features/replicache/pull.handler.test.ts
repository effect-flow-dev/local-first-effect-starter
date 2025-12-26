// FILE: src/features/replicache/pull.handler.test.ts
import { vi, describe, it, expect, afterEach } from "vitest";
import { Effect, Either } from "effect";
import { handlePull } from "./pull";
import type { User, UserId } from "../../lib/shared/schemas";
import type { PullRequest } from "../../lib/shared/replicache-schemas";
import { ClientStateNotFoundError } from "./Errors";

// --- Mocks ---
const { mockNoteSync, mockBlockSync, mockGetCurrentGlobalVersion } = vi.hoisted(() => ({
  mockNoteSync: { getPatchOperations: vi.fn() },
  mockBlockSync: { getPatchOperations: vi.fn() },
  mockGetCurrentGlobalVersion: vi.fn(),
}));

vi.mock("../../lib/server/sync/sync.registry", () => ({
  syncableEntities: [mockNoteSync, mockBlockSync],
}));

vi.mock("./versioning", () => ({
  getCurrentGlobalVersion: mockGetCurrentGlobalVersion,
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

const mockUser: User = {
  id: "u1" as UserId,
  email: "test@example.com",
  password_hash: "pw",
  email_verified: true,
  created_at: new Date(),
  avatar_url: null,
  permissions: [],
  // ✅ FIX: Removed tenant_strategy, database_name, subdomain
};

const { mockDb, mockExecute } = vi.hoisted(() => {
  const mockExecute = vi.fn().mockResolvedValue([]);
  const mockExecuteTakeFirst = vi.fn();

  const mockQueryBuilder = {
    values: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    column: vi.fn().mockReturnThis(),
    doNothing: vi.fn().mockReturnThis(),
    selectFrom: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: mockExecute,
    executeTakeFirst: mockExecuteTakeFirst,
  };

  const mockTrx = {
    insertInto: vi.fn().mockReturnValue(mockQueryBuilder),
    selectFrom: vi.fn().mockReturnValue(mockQueryBuilder),
  };

  const mockDb = {
    transaction: vi.fn(() => ({
      execute: (fn: (trx: any) => any) => fn(mockTrx),
    })),
  } as any;

  return { mockDb, mockExecute, mockExecuteTakeFirst };
});

describe("Replicache: handlePull (Filtered Sync & Time Travel)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adds 'clear' op when cookie is null (Fresh Sync)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const req: PullRequest = {
          clientGroupID: "group-1",
          cookie: null,
          filter: { tags: ["#business"] }
        };

        mockExecute.mockResolvedValue([]); 
        mockGetCurrentGlobalVersion.mockReturnValue(Effect.succeed(50));
        mockNoteSync.getPatchOperations.mockReturnValue(Effect.succeed([]));
        mockBlockSync.getPatchOperations.mockReturnValue(Effect.succeed([]));

        // ✅ FIX: Cast mockUser to any (though updates above should make it valid User)
        const result = yield* Effect.either(handlePull(req, mockUser as any, mockDb));

        expect(Either.isRight(result)).toBe(true);
        if (Either.isRight(result)) {
          const response = result.right;
          expect(response.patch[0]).toEqual({ op: "clear" });
        }
      }),
    );
  });

  it("does NOT add 'clear' op for incremental sync (cookie > 0)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const req: PullRequest = {
          clientGroupID: "group-1",
          cookie: 100,
          filter: { tags: ["#business"] }
        };

        mockExecute.mockResolvedValue([]); 
        mockGetCurrentGlobalVersion.mockReturnValue(Effect.succeed(105));

        mockNoteSync.getPatchOperations.mockReturnValue(Effect.succeed([]));
        mockBlockSync.getPatchOperations.mockReturnValue(Effect.succeed([]));

        const result = yield* Effect.either(handlePull(req, mockUser as any, mockDb));

        if (Either.isRight(result)) {
          const response = result.right;
          expect(response.patch).toHaveLength(0);
          expect(response.patch.find(p => p.op === 'clear')).toBeUndefined();
        }
      }),
    );
  });

  it("fails with ClientStateNotFoundError when client cookie is from future (Time Travel)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const req: PullRequest = {
          clientGroupID: "group-1",
          cookie: 9999, // Future!
          filter: undefined
        };

        mockExecute.mockResolvedValue([]); 
        mockGetCurrentGlobalVersion.mockReturnValue(Effect.succeed(50)); // Server is only at 50

        // Mocks shouldn't be called if it fails early
        mockNoteSync.getPatchOperations.mockReturnValue(Effect.succeed([]));

        const result = yield* Effect.either(handlePull(req, mockUser as any, mockDb));

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left).toBeInstanceOf(ClientStateNotFoundError);
        }
      }),
    );
  });
});
