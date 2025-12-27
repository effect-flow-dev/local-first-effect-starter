// FILE: src/features/block/validation.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { handlePush } from "../replicache/push";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId, PublicUser } from "../../lib/shared/schemas";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

// Mock Poke to suppress WebSocket side effects
vi.mock("../../lib/server/PokeService", () => ({
  poke: vi.fn(() => Effect.void),
}));

describe("Strict Block Schema Validation (Integration)", () => {
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
    return async () => await cleanup();
  });

  const mockUser: PublicUser = {
    id: "u1" as UserId,
    email: "validation@test.com",
    email_verified: true,
    created_at: new Date(),
    avatar_url: null,
    permissions: [],
  };

  const setupNote = (noteId: NoteId) => 
    Effect.promise(() =>
        db.insertInto("note")
          .values({
            id: noteId,
            user_id: schemaUserId,
            title: "Validation Test",
            content: { type: "doc", content: [] },
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute()
    );

  it("REJECTS: form_checklist with generic/missing fields", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        yield* setupNote(noteId);

        const invalidPush: PushRequest = {
          clientGroupID: "bad-client",
          mutations: [{
            id: 1,
            clientID: "c1",
            name: "createBlock",
            args: {
                noteId,
                blockId,
                type: "form_checklist",
                // BAD: Missing 'items', has 'value' instead
                fields: { value: 10 }, 
                latitude: 0, 
                longitude: 0
            }
          }]
        };

        // We spy on console.error to confirm the rejection log, as handlePush swallows errors to not crash queue
        const errorSpy = vi.spyOn(console, "error");
        
        yield* handlePush(invalidPush, { ...mockUser, id: schemaUserId }, db, "OWNER");

        // Should log validation error
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("[Push] Schema Validation Failed for createBlock"),
            expect.any(String)
        );

        // Verify Block was NOT created
        const block = yield* Effect.promise(() =>
            db.selectFrom("block").selectAll().where("id", "=", blockId).executeTakeFirst()
        );
        expect(block).toBeUndefined();
      })
    );
  });

  it("REJECTS: GeoLocation out of range", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        yield* setupNote(noteId);

        const invalidPush: PushRequest = {
          clientGroupID: "bad-geo",
          mutations: [{
            id: 1,
            clientID: "c2",
            name: "createBlock",
            args: {
                noteId,
                blockId,
                type: "map_block",
                fields: { zoom: 10 },
                latitude: 999, // BAD: > 90
                longitude: 0
            }
          }]
        };

        const errorSpy = vi.spyOn(console, "error");
        yield* handlePush(invalidPush, { ...mockUser, id: schemaUserId }, db, "OWNER");

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Schema Validation Failed"),
            expect.stringContaining("Invalid Latitude")
        );

        const block = yield* Effect.promise(() =>
            db.selectFrom("block").selectAll().where("id", "=", blockId).executeTakeFirst()
        );
        expect(block).toBeUndefined();
      })
    );
  });

  it("ACCEPTS: Valid Meter Block", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        yield* setupNote(noteId);

        const validPush: PushRequest = {
          clientGroupID: "good-client",
          mutations: [{
            id: 1,
            clientID: "c3",
            name: "createBlock",
            args: {
                noteId,
                blockId,
                type: "form_meter",
                fields: { label: "Speed", value: 60, min: 0, max: 120, unit: "mph" },
                latitude: 40.7128,
                longitude: -74.0060
            }
          }]
        };

        yield* handlePush(validPush, { ...mockUser, id: schemaUserId }, db, "OWNER");

        const block = yield* Effect.promise(() =>
            // ✅ FIX: Added .selectAll() so TypeScript infers the columns (including latitude)
            db.selectFrom("block").selectAll().where("id", "=", blockId).executeTakeFirst()
        );
        expect(block).toBeDefined();
        // @ts-expect-error jsonb access
        expect(block.fields.label).toBe("Speed");
        expect(block?.latitude).toBeCloseTo(40.7128);
      })
    );
  });
});
