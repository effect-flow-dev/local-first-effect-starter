// FILE: src/features/replicache/conflict.integration.test.ts
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
            timestamp: sql`timestamp - (${seconds} * interval '1 second')`
        })
        .execute();
  };

  it("injects an AlertBlock when a stale write attempts to overwrite a critical status", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = schemaUserId;
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        // --- 1. SETUP: Create Initial Note with a Task (Version 1) ---
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
            })
            .execute()
        );

        // Force time gap
        yield* Effect.promise(() => ageHistory(3600));

        // --- 2. DEVICE A (Online): Sets Status to "BLOCKED" ---
        yield* handleUpdateBlock(
          db,
          {
            blockId,
            fields: { status: "blocked", is_complete: false },
            version: 1,
          },
          userId
        );

        const blockV2 = yield* Effect.promise(() =>
          db
            .selectFrom("block")
            .select(["version", "fields"])
            .where("id", "=", blockId)
            .executeTakeFirstOrThrow()
        );
        expect(blockV2.version).toBe(2);
        // @ts-expect-error jsonb access
        expect(blockV2.fields.status).toBe("blocked");

        // Force time gap
        yield* Effect.promise(() => ageHistory(3600));

        // --- 3. DEVICE B (Was Offline): Tries to set Status to "DONE" ---
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
                version: 1, // STALE! Server is at 2.
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

        // --- 4. EXECUTE PUSH ---
        yield* handlePush(stalePush, mockUser, db, "OWNER");

        // --- 5. VERIFICATIONS ---
        const history = yield* Effect.promise(() =>
          db
            .selectFrom("block_history")
            .selectAll()
            .where("block_id", "=", blockId)
            .orderBy("timestamp", "asc")
            .execute()
        );
        
        expect(history).toHaveLength(2);
        const rejectedEntry = history[1];
        if (!rejectedEntry) throw new Error("Expected rejected entry");

        expect(rejectedEntry.was_rejected).toBe(true);
        expect(JSON.stringify(rejectedEntry.change_delta)).toContain("done");

        // B. Verify Note Content now contains AlertBlock
        const note = yield* Effect.promise(() =>
            db.selectFrom("note").select("content").where("id", "=", noteId).executeTakeFirstOrThrow()
        );
        
        // Handle content whether it's string (JSON) or object
        const content = typeof note.content === 'string' 
            ? JSON.parse(note.content) 
            : note.content as any;
            
        const nodes = content.content || [];
        
        const alertNode = nodes.find((n: any) => n.type === "alertBlock");
        
        expect(alertNode).toBeDefined();
        expect(alertNode.attrs.level).toBe("error");
        expect(alertNode.attrs.message).toContain("Sync Conflict");
      })
    );
  });
});
