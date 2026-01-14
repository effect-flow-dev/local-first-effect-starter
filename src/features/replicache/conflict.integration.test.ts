// File: ./src/features/replicache/conflict.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { handlePush } from "./push";
import { handleUpdateBlock } from "../note/note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId, PublicUser } from "../../lib/shared/schemas";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../types";

vi.mock("../../lib/server/PokeService", () => ({
  poke: vi.fn(() => Effect.void),
}));

describe("Conflict Resolution (Trojan Horse)", () => {
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

  const ageHistory = async (seconds: number) => {
      await db.updateTable("block_history")
        .set({
            device_timestamp: sql`device_timestamp - (${seconds} * interval '1 second')`
        })
        .execute();
  };

  it("injects an AlertBlock when a stale write attempts to overwrite a critical status", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = schemaUserId;
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        yield* Effect.promise(() =>
          db
            .insertInto("note")
            .values({
              id: noteId,
              user_id: userId,
              title: "Smart Report",
              content: {
                type: "doc",
                content: [
                  {
                    type: "interactiveBlock",
                    attrs: {
                      blockId: blockId,
                      version: 1,
                      blockType: "task",
                      fields: { is_complete: false, status: "todo" },
                    },
                  },
                ],
              },
              version: 1,
              created_at: new Date(),
              updated_at: new Date(),
              global_version: "1736612345000:0001:SYSTEM"
            })
            .execute()
        );

        yield* Effect.promise(() =>
          db
            .insertInto("block")
            .values({
              id: blockId,
              note_id: noteId,
              user_id: userId,
              type: "task",
              content: "",
              fields: { is_complete: false, status: "todo" },
              version: 1,
              file_path: "",
              depth: 0,
              order: 0,
              tags: [],
              links: [],
              transclusions: [],
              created_at: new Date(),
              updated_at: new Date(),
              global_version: "1736612345000:0001:SYSTEM"
            })
            .execute()
        );

        yield* Effect.promise(() => ageHistory(3600));

        // T1: Valid Update to "blocked"
        yield* handleUpdateBlock(
          db,
          {
            blockId,
            fields: { status: "blocked", is_complete: false },
            version: 1,
          },
          userId,
          "1736612346000:0001:DEVICE_A" 
        );

        yield* Effect.promise(() => ageHistory(3600));

        // T2: Stale Push (Version 1) trying to set "done"
        const stalePush: PushRequest = {
          clientGroupID: "device-b-group",
          mutations: [
            {
              id: 1,
              clientID: "device-b",
              name: "updateBlock",
              args: {
                blockId,
                fields: { status: "done", is_complete: true },
                version: 1, 
                hlcTimestamp: "1736612344000:0001:DEVICE_B", // Stale HLC
              },
            },
          ],
        };

        const mockUser: PublicUser = {
          id: userId, 
          email: "test@test.com",
          email_verified: true,
          created_at: new Date(),
          avatar_url: null,
          permissions: [],
        };

        yield* handlePush(stalePush, mockUser, db, "OWNER");

        // Verification
        const history = yield* Effect.promise(() =>
          db
            .selectFrom("block_history")
            .selectAll()
            .where("block_id", "=", blockId)
            .orderBy("hlc_timestamp", "asc")
            .execute()
        );
        
        // Expect 1 history entry (from T1). 
        // T2 was rejected and NOT logged (Linear History).
        expect(history).toHaveLength(1);
        expect(history[0]!.mutation_type).toBe("updateBlock");

        // Verify Conflict Resolution (Alert Injection)
        const note = yield* Effect.promise(() =>
            db.selectFrom("note").select("content").where("id", "=", noteId).executeTakeFirstOrThrow()
        );
        
        const content = typeof note.content === 'string' 
            ? JSON.parse(note.content) 
            : note.content as any;
            
        const nodes = content.content || [];
        const alertNode = nodes.find((n: any) => n.type === "alertBlock");
        
        // Assert that the system detected the conflict and injected the alert into the document
        expect(alertNode).toBeDefined();
        expect(alertNode.attrs.level).toBe("error");
      })
    );
  });
});
