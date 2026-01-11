// File: src/features/block/validation.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { handlePush } from "../replicache/push";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId, PublicUser } from "../../lib/shared/schemas";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

const TEST_HLC = "1736612345000:0001:TEST";

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
            global_version: TEST_HLC,
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
                fields: { value: 10 }, 
                latitude: 0, 
                longitude: 0,
                hlcTimestamp: TEST_HLC
            }
          }]
        };

        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        
        yield* handlePush(invalidPush, { ...mockUser, id: schemaUserId }, db, "OWNER");

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Mutation FAILED: createBlock")
        );
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("is missing")
        );

        const block = yield* Effect.promise(() =>
            db.selectFrom("block").selectAll().where("id", "=", blockId).executeTakeFirst()
        );
        expect(block).toBeUndefined();
        
        errorSpy.mockRestore();
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
                latitude: 999, 
                longitude: 0,
                hlcTimestamp: TEST_HLC
            }
          }]
        };

        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        yield* handlePush(invalidPush, { ...mockUser, id: schemaUserId }, db, "OWNER");

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Mutation FAILED: createBlock")
        );
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Invalid Latitude: must be between -90 and 90")
        );

        const block = yield* Effect.promise(() =>
            db.selectFrom("block").selectAll().where("id", "=", blockId).executeTakeFirst()
        );
        expect(block).toBeUndefined();
        
        errorSpy.mockRestore();
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
                longitude: -74.0060,
                hlcTimestamp: TEST_HLC
            }
          }]
        };

        yield* handlePush(validPush, { ...mockUser, id: schemaUserId }, db, "OWNER");

        const block = yield* Effect.promise(() =>
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
