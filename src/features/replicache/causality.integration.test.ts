// File: src/features/replicache/causality.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { Effect } from "effect";
import { handlePush } from "./push";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId, PublicUser } from "../../lib/shared/schemas";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import { packHlc } from "../../lib/shared/hlc";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

vi.mock("../../lib/server/PokeService", () => ({
  poke: vi.fn(() => Effect.void),
}));

describe("HLC Causality & Clock Skew (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let schemaUserId: UserId;

  // ✅ FIX: Standard test era (Jan 2025)
  const BASE_TEST_TIME = 1736612400000;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    // ✅ FIX: Stabilize system clock for HLC generation
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TEST_TIME);

    const userId = randomUUID();
    schemaUserId = userId as UserId;
    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;
    return async () => await cleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockUser: PublicUser = {
    id: "u1" as UserId,
    email: "causality@test.com",
    email_verified: true,
    created_at: new Date(),
    avatar_url: null,
    permissions: [],
  };

  it("should preserve causal order when Client B has a slower physical clock than Client A", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        // SCENARIO:
        // T1: Client A (10:00 AM) performs Action 1.
        // T2: Client B (09:55 AM - Slow Clock) performs Action 2.
        
        const timeA = BASE_TEST_TIME; // 10:00 AM
        const timeB = BASE_TEST_TIME - 300000; // 09:55 AM

        const hlcA = packHlc({ physical: timeA, counter: 0, nodeId: "CLIENT_A" });

        // 1. Client A Pushes Action 1
        const pushA: PushRequest = {
          clientGroupID: "cg-a",
          mutations: [{
            id: 1,
            clientID: "c-a",
            name: "createNote",
            args: {
                id: noteId,
                userID: schemaUserId,
                title: "Action 1",
                hlcTimestamp: hlcA,
                deviceTimestamp: new Date(timeA)
            }
          }]
        };

        yield* handlePush(pushA, { ...mockUser, id: schemaUserId }, db, "OWNER");

        // 2. Client B (Lagging) performs Action 2. 
        // We advance system time but keep it "behind" A's physical time.
        vi.setSystemTime(timeB + 1000); // 09:55:01 AM

        const hlcB = packHlc({ physical: timeA, counter: 1, nodeId: "CLIENT_B" });

        const pushB: PushRequest = {
            clientGroupID: "cg-b",
            mutations: [{
              id: 1,
              clientID: "c-b",
              name: "createBlock",
              args: {
                  noteId,
                  blockId,
                  type: "tiptap_text",
                  content: "Action 2",
                  hlcTimestamp: hlcB,
                  deviceTimestamp: new Date(timeB + 1000)
              }
            }]
        };

        yield* handlePush(pushB, { ...mockUser, id: schemaUserId }, db, "OWNER");

        // 3. VERIFICATION
        const history = yield* Effect.tryPromise({
            try: () => db
                .selectFrom("block_history")
                .selectAll()
                .orderBy("hlc_timestamp", "asc")
                .execute(),
            catch: (cause) => new Error(`Failed to fetch history: ${String(cause)}`)
        });

        expect(history).toHaveLength(2);

        const action1 = history[0]!;
        const action2 = history[1]!;

        // Device clock was lagging
        expect(action2.device_timestamp.getTime()).toBeLessThan(action1.device_timestamp.getTime());
        
        // ✅ FIX: Causal ordering is preserved lexicographically.
        // Action 2 must be > Action 1.
        expect(action2.hlc_timestamp > action1.hlc_timestamp).toBe(true);

        yield* Effect.logInfo("[Causality Test] PASS");
      })
    );
  });
});
