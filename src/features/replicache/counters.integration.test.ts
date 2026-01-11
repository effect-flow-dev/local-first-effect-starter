// File: src/features/replicache/counters.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { Effect } from "effect";
import { handlePush } from "./push";
import { handleCreateNote, handleCreateBlock } from "../note/note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId, PublicUser } from "../../lib/shared/schemas";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

vi.mock("../../lib/server/PokeService", () => ({
  poke: vi.fn(() => Effect.void),
}));

describe("Counters & Atomic Increments (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let schemaUserId: UserId;

  // ✅ FIX: Standard test era (Jan 2025)
  const BASE_TEST_TIME = 1736612345000;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    // ✅ FIX: Stabilize clock for HLC consistency
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TEST_TIME);

    const userId = randomUUID();
    schemaUserId = userId as UserId;

    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;

    return async () => {
      await cleanup();
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const getMockUser = (id: UserId): PublicUser => ({
    id,
    email: "tester@test.com",
    email_verified: true,
    created_at: new Date(),
    avatar_url: null,
    permissions: [],
  });

  it("should correctly apply concurrent atomic increments (defeat Last-Write-Wins)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = schemaUserId; 
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        yield* handleCreateNote(db, {
            id: noteId,
            userID: userId,
            title: "Counter Test",
        }, "1736612345000:0001:SYSTEM");

        yield* handleCreateBlock(db, {
            noteId,
            blockId,
            type: "form_meter",
            fields: { value: 0, min: 0, max: 100, label: "Counter", unit: "count" },
        }, userId, "1736612345000:0002:SYSTEM");

        const initialBlock = yield* Effect.promise(() =>
          db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        // @ts-expect-error jsonb access
        expect(initialBlock.fields.value).toBe(0);

        vi.setSystemTime(1736612346000);

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
                version: 1,
                hlcTimestamp: "1736612346000:0001:CLIENT_A"
              },
            },
          ],
        };

        vi.setSystemTime(1736612347000);

        const pushB: PushRequest = {
          clientGroupID: "client-group-b",
          mutations: [
            {
              id: 1, 
              clientID: "client-b",
              name: "incrementCounter",
              args: {
                blockId,
                key: "value",
                delta: 5,
                version: 1, 
                hlcTimestamp: "1736612347000:0001:CLIENT_B"
              },
            },
          ],
        };

        yield* handlePush(pushA, getMockUser(userId), db, "OWNER");
        yield* handlePush(pushB, getMockUser(userId), db, "OWNER");

        const finalBlock = yield* Effect.promise(() =>
            db.selectFrom("block").select(["fields", "global_version"]).where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        
        // @ts-expect-error jsonb access
        expect(finalBlock.fields.value).toBe(10);

        expect(finalBlock.global_version).toContain("1736612347000");
      })
    );
  });

  it("should handle decrements correctly", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = schemaUserId;
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        yield* handleCreateNote(db, { id: noteId, userID: userId, title: "Decrement Test" }, "1736612345000:0001:SYSTEM");
        yield* handleCreateBlock(db, {
          noteId,
          blockId,
          type: "form_meter",
          fields: { value: 20, min: 0, max: 100, label: "Test", unit: "pts" },
        }, userId, "1736612345000:0002:SYSTEM");

        const push: PushRequest = {
          clientGroupID: "cg-1",
          mutations: [{
            id: 1,
            clientID: "c1",
            name: "incrementCounter",
            args: { blockId, key: "value", delta: -5, version: 1, hlcTimestamp: "1736612346000:0001:C1" },
          }],
        };

        yield* handlePush(push, getMockUser(userId), db, "OWNER");

        const block = yield* Effect.promise(() =>
            db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        // @ts-expect-error jsonb access
        expect(block.fields.value).toBe(15);
      })
    );
  });

  it("should initialize and increment a missing field (COALESCE check)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = schemaUserId;
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        yield* handleCreateNote(db, { id: noteId, userID: userId, title: "Null Test" }, "1736612345000:0001:SYSTEM");
        yield* handleCreateBlock(db, {
          noteId,
          blockId,
          type: "tiptap_text", 
          fields: {},
        }, userId, "1736612345000:0002:SYSTEM");

        const push: PushRequest = {
          clientGroupID: "cg-null",
          mutations: [{
            id: 1,
            clientID: "c-null",
            name: "incrementCounter",
            args: { blockId, key: "score", delta: 10, version: 1, hlcTimestamp: "1736612346000:0001:C-NULL" },
          }],
        };

        yield* handlePush(push, getMockUser(userId), db, "OWNER");

        const block = yield* Effect.promise(() =>
            db.selectFrom("block").select("fields").where("id", "=", blockId).executeTakeFirstOrThrow()
        );
        
        // @ts-expect-error jsonb access
        expect(block.fields.score).toBe(10);
      })
    );
  });
});
