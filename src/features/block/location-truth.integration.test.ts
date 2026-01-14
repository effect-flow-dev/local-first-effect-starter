// FILE: src/features/block/location-truth.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { handlePush } from "../replicache/push";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId, EntityId, PublicUser } from "../../lib/shared/schemas";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

const TEST_HLC = "1736612345000:0001:TEST";

// Mock PokeService to avoid WebSocket side effects
vi.mock("../../lib/server/PokeService", () => ({
  poke: vi.fn(() => Effect.void),
}));

describe("Location Truth & Forensic Audit (Integration)", () => {
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

  // ✅ FIX: Use a function to access schemaUserId AFTER it has been initialized in beforeEach
  const getMockUser = (): PublicUser => ({
    id: schemaUserId,
    email: "audit@test.com",
    email_verified: true,
    created_at: new Date(),
    avatar_url: null,
    permissions: [],
  });

  const createNote = (noteId: NoteId) =>
    Effect.promise(() =>
      db.insertInto("note")
        .values({
          id: noteId,
          user_id: schemaUserId,
          title: "Audit Log",
          content: { type: "doc", content: [] },
          version: 1,
          global_version: TEST_HLC,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute()
    );

  const createEntity = (id: EntityId, name: string, lat: number, lon: number) =>
    Effect.promise(() =>
      db.insertInto("entity")
        .values({
          id,
          name,
          latitude: lat,
          longitude: lon,
          description: "Fixed Asset",
          created_at: new Date(),
          updated_at: new Date()
        })
        .execute()
    );

  it("should enforce Entity Truth: Overwrites manual coordinates with Entity coordinates", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;
        const entityId = randomUUID() as EntityId;

        // 1. Setup Data
        yield* createNote(noteId);
        yield* createEntity(entityId, "Server Rack A", 51.5074, -0.1278); // London

        // 2. Client attempts to push with Entity ID but conflicting coords (e.g. New York)
        const pushReq: PushRequest = {
          clientGroupID: "client-group-1",
          mutations: [
            {
              id: 1,
              clientID: "client-1",
              name: "createBlock",
              args: {
                noteId,
                blockId,
                type: "map_block",
                fields: { zoom: 10 },
                // Client tries to claim it's here:
                latitude: 40.7128, 
                longitude: -74.0060, 
                // But links it to the London entity:
                entityId: entityId,
                locationSource: "manual", // Client says manual
                hlcTimestamp: TEST_HLC,
                deviceTimestamp: new Date(),
              },
            },
          ],
        };

        // 3. Process Push
        yield* handlePush(pushReq, getMockUser(), db, "OWNER");

        // 4. Verify DB
        const block = yield* Effect.promise(() =>
          db.selectFrom("block")
            .selectAll()
            .where("id", "=", blockId)
            .executeTakeFirstOrThrow()
        );

        // Expect coordinates to match the Entity (London), NOT the client payload (NY)
        expect(block.latitude).toBeCloseTo(51.5074);
        expect(block.longitude).toBeCloseTo(-0.1278);
        
        // Expect source to be enforced
        expect(block.location_source).toBe("entity_fixed");
        expect(block.entity_id).toBe(entityId);
      })
    );
  });

  it("should capture Chain of Custody in block_history when switching context", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;
        const entityId = randomUUID() as EntityId;

        yield* createNote(noteId);
        yield* createEntity(entityId, "Secure Room", 35.6895, 139.6917); // Tokyo

        // 1. Create Block (Manual Location)
        const push1: PushRequest = {
          clientGroupID: "client-group-1",
          mutations: [{
            id: 1,
            clientID: "client-1",
            name: "createBlock",
            args: {
              noteId,
              blockId,
              type: "map_block",
              fields: { zoom: 10 },
              latitude: 0,
              longitude: 0,
              locationSource: "manual",
              hlcTimestamp: "1736612345000:0001:A",
            }
          }]
        };
        yield* handlePush(push1, getMockUser(), db, "OWNER");

        // 2. Update Block (Link to Entity)
        const push2: PushRequest = {
          clientGroupID: "client-group-1",
          mutations: [{
            id: 2,
            clientID: "client-1",
            name: "updateBlock",
            args: {
              blockId,
              fields: {}, // No field changes, just location context
              version: 1,
              // Linking to entity
              entityId, 
              // Sending conflicting coords (ignored)
              // ✅ FIX: Use valid coords within -90/90 range to pass schema validation
              latitude: 10, longitude: 10, 
              hlcTimestamp: "1736612346000:0001:A",
            }
          }]
        };
        yield* handlePush(push2, getMockUser(), db, "OWNER");

        // 3. Verify History
        const history = yield* Effect.promise(() =>
          db.selectFrom("block_history")
            .select(["mutation_type", "location_source", "entity_id", "hlc_timestamp"])
            .where("block_id", "=", blockId)
            .orderBy("hlc_timestamp", "asc")
            .execute()
        );

        expect(history).toHaveLength(2);

        // Entry 1: Manual creation
        expect(history[0]).toMatchObject({
            mutation_type: "createBlock",
            location_source: "manual",
            entity_id: null
        });

        // Entry 2: Update to Fixed Asset
        expect(history[1]).toMatchObject({
            mutation_type: "updateBlock",
            location_source: "entity_fixed",
            entity_id: entityId
        });
      })
    );
  });
});
