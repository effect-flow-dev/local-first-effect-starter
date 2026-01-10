// FILE: src/features/replicache/filtered-sync.integration.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { handlePull } from "./pull";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId, PublicUser } from "../../lib/shared/schemas";
import type { PullRequest } from "../../lib/shared/replicache-schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

describe("Filtered Sync (The Lens) - Integration", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let schemaUserId: UserId;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    // 1. Generate ID and create schema for THIS user
    const id = randomUUID();
    schemaUserId = id as UserId; 
    
    const setup = await createTestUserSchema(id);
    db = setup.db;
    cleanup = setup.cleanup;
    return async () => await cleanup();
  });

  const setupTaggedData = (userId: UserId) =>
    Effect.gen(function* () {
      // Note A: Tagged #business
      const noteA = randomUUID() as NoteId;
      yield* Effect.promise(() =>
        db.insertInto("note")
          .values({
            id: noteA,
            user_id: userId,
            title: "Log",
            content: { type: "doc", content: [] },
            version: 1,
            global_version: "10",
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute()
      );
      yield* Effect.promise(() =>
        db.insertInto("block")
          .values({
            id: randomUUID() as BlockId,
            note_id: noteA,
            user_id: userId,
            type: "text",
            content: "Management #business",
            tags: ["#business"], // Matches filter
            fields: {},
            links: [],
            transclusions: [],
            file_path: "",
            depth: 0,
            order: 0,
            version: 1,
            global_version: "11",
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute()
      );

      // Note B: Tagged #maintenance
      const noteB = randomUUID() as NoteId;
      yield* Effect.promise(() =>
        db.insertInto("note")
          .values({
            id: noteB,
            user_id: userId,
            title: "Routine Check",
            content: { type: "doc", content: [] },
            version: 1,
            global_version: "12",
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute()
      );
      yield* Effect.promise(() =>
        db.insertInto("block")
          .values({
            id: randomUUID() as BlockId,
            note_id: noteB,
            user_id: userId,
            type: "text",
            content: "Fix pipe #maintenance",
            tags: ["#maintenance"], // Does NOT match filter
            fields: {},
            links: [],
            transclusions: [],
            file_path: "",
            depth: 0,
            order: 0,
            version: 1,
            global_version: "13",
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute()
      );

      return { noteA, noteB };
    });

  it("should only return notes/blocks matching the '#business' tag filter", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = schemaUserId;
        const { noteA, noteB } = yield* setupTaggedData(userId);

        const mockUser: PublicUser = {
          id: userId,
          email: "test@lens.com",
          email_verified: true,
          created_at: new Date(),
          avatar_url: null,
          permissions: [],
        };

        const request: PullRequest = {
          clientGroupID: "lens-client",
          cookie: null, // Fresh sync
          filter: { tags: ["#business"] }, // THE LENS
        };

        const response = yield* handlePull(request, mockUser, db);

        const keys = response.patch.map((op) => {
            if (op.op === 'clear') return 'clear';
            return op.key;
        });
        
        expect(keys).toContain(`note/${noteA}`);
        expect(keys).not.toContain(`note/${noteB}`);

        // Verify the 'clear' op is present for fresh filtered sync
        expect(keys).toContain("clear");
      })
    );
  });

  it("should return everything if no filter is provided", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = schemaUserId;
        const { noteA, noteB } = yield* setupTaggedData(userId);

        const mockUser: PublicUser = {
          id: userId,
          email: "test@all.com",
          email_verified: true,
          created_at: new Date(),
          avatar_url: null,
          permissions: [],
        };

        const request: PullRequest = {
          clientGroupID: "all-client",
          cookie: null,
          filter: undefined, // No Lens
        };

        const response = yield* handlePull(request, mockUser, db);

        const keys = response.patch.map((op) => {
            if (op.op === 'clear') return 'clear';
            return op.key;
        });
        
        expect(keys).toContain(`note/${noteA}`);
        expect(keys).toContain(`note/${noteB}`);
      })
    );
  });
});
