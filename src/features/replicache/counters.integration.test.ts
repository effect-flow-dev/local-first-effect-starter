// FILE: src/features/replicache/counters.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { handlePush } from "./push";
import { handleCreateNote, handleCreateBlock } from "../note/note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId, PublicUser } from "../../lib/shared/schemas";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

// Mock services to avoid external noise
vi.mock("../../lib/server/PokeService", () => ({
  poke: vi.fn(() => Effect.void),
}));

describe("Counters & Atomic Increments (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let schemaUserId: UserId;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    const userId = randomUUID();
    schemaUserId = userId as UserId;

    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;

    return async () => {
      await cleanup();
    };
  });

  const mockUser: PublicUser = {
    id: "u1" as UserId,
    email: "tester@test.com",
    email_verified: true,
    created_at: new Date(),
    avatar_url: null,
    permissions: [],
    // Legacy fields
    tenant_strategy: "schema",
    database_name: null,
    subdomain: "test",
  };

  it("should correctly apply concurrent atomic increments (defeat Last-Write-Wins)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = schemaUserId;
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        // 1. Setup: Create Note & Block with initial value 0
        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "Counter Test",
        });

        yield* handleCreateBlock(db, {
          noteId,
          blockId,
          type: "form_meter",
          fields: { value: 0 },
        }, userId);

        // Verify initial state
        const initialBlock = yield* Effect.promise(() =>
          db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        // @ts-expect-error jsonb access
        expect(initialBlock.fields.value).toBe(0);

        // 2. Simulate User A: Pushes "Add 5"
        // This simulates the client calculating 0 + 5 = 5, but sending delta: 5
        const pushA: PushRequest = {
          clientGroupID: "client-group-a",
          mutations: [
            {
              id: 1,
              clientID: "client-a",
              name: "incrementCounter",
              args: {
                blockId,
                key: "value",
                delta: 5,
                version: 1, // Base version
              },
            },
          ],
        };

        // 3. Simulate User B: Pushes "Add 5" concurrently
        // User B also sees value 0 locally (base version 1), adds 5.
        // If this were "updateBlock" setting value=5, the final result would be 5 (LWW).
        // Since it's "incrementCounter" delta=5, the final result should be 10.
        const pushB: PushRequest = {
          clientGroupID: "client-group-b",
          mutations: [
            {
              id: 1, // First mutation for this client
              clientID: "client-b",
              name: "incrementCounter",
              args: {
                blockId,
                key: "value",
                delta: 5,
                version: 1, // Same base version as User A saw!
              },
            },
          ],
        };

        // Execute A
        yield* handlePush(pushA, { ...mockUser, id: userId }, db, "OWNER");

        // Intermediate verification (optional)
        const blockAfterA = yield* Effect.promise(() =>
            db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        // @ts-expect-error jsonb access
        expect(blockAfterA.fields.value).toBe(5);

        // Execute B
        yield* handlePush(pushB, { ...mockUser, id: userId }, db, "OWNER");

        // 4. Assertion: Final Value should be 10
        const finalBlock = yield* Effect.promise(() =>
            db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        
        // @ts-expect-error jsonb access
        expect(finalBlock.fields.value).toBe(10);
      })
    );
  });

  it("should handle decrements correctly", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = schemaUserId;
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        // 1. Setup: Value 20
        yield* handleCreateNote(db, { id: noteId, userID: userId, title: "Decrement Test" });
        yield* handleCreateBlock(db, {
          noteId,
          blockId,
          type: "form_meter",
          fields: { value: 20 },
        }, userId);

        // 2. Push Decrement (-5)
        const push: PushRequest = {
          clientGroupID: "cg-1",
          mutations: [{
            id: 1,
            clientID: "c1",
            name: "incrementCounter",
            args: { blockId, key: "value", delta: -5, version: 1 },
          }],
        };

        yield* handlePush(push, { ...mockUser, id: userId }, db, "OWNER");

        // 3. Verify
        const block = yield* Effect.promise(() =>
            db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        // @ts-expect-error jsonb access
        expect(block.fields.value).toBe(15);
      })
    );
  });
});
