// FILE: src/features/media/file-upload.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { handlePush } from "../replicache/push";
import { handleCreateNote } from "../note/note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId, PublicUser } from "../../lib/shared/schemas";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

const TEST_HLC = "1736612345000:0001:TEST";

// Mock PokeService to avoid WebSocket side effects
vi.mock("../../lib/server/PokeService", () => ({
  poke: vi.fn(() => Effect.void),
}));

describe("File Attachment Persistence (Integration)", () => {
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
    email: "file-test@example.com",
    email_verified: true,
    created_at: new Date(),
    avatar_url: null,
    permissions: [],
  };

  it("should persist a file_attachment block with PDF metadata", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        // 1. Create Note
        yield* handleCreateNote(
          db,
          {
            id: noteId,
            userID: schemaUserId,
            title: "Documents Note",
          },
          TEST_HLC
        );

        // 2. Push file_attachment mutation
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
                type: "file_attachment",
                fields: {
                  filename: "contract.pdf",
                  size: 1024500, // ~1MB
                  mimeType: "application/pdf",
                  uploadId: "pending-upload-uuid",
                  url: null, // Not uploaded yet
                },
                hlcTimestamp: "1736612345000:0002:TEST",
                deviceTimestamp: new Date(),
              },
            },
          ],
        };

        // 3. Execute Push
        // We override the user ID in the mockUser to match the schema owner
        yield* handlePush(pushReq, { ...mockUser, id: schemaUserId }, db, "OWNER");

        // 4. Verify DB State
        const block = yield* Effect.promise(() =>
          db
            .selectFrom("block")
            .selectAll()
            .where("id", "=", blockId)
            .executeTakeFirstOrThrow()
        );

        expect(block.type).toBe("file_attachment");
        
        // Check JSONB fields
        const fields = block.fields as Record<string, unknown>;
        expect(fields.filename).toBe("contract.pdf");
        expect(fields.mimeType).toBe("application/pdf");
        expect(fields.size).toBe(1024500);
        expect(fields.uploadId).toBe("pending-upload-uuid");
      })
    );
  });

  it("should reject a file_attachment block missing required metadata fields", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const noteId = randomUUID() as NoteId;
        const blockId = randomUUID() as BlockId;

        yield* handleCreateNote(
            db,
            { id: noteId, userID: schemaUserId, title: "Bad Data" },
            TEST_HLC
        );

        const invalidPush: PushRequest = {
          clientGroupID: "client-group-bad",
          mutations: [
            {
              id: 1,
              clientID: "client-bad",
              name: "createBlock",
              args: {
                noteId,
                blockId,
                type: "file_attachment",
                fields: {
                  // Missing filename, size, mimeType
                  uploadId: "123",
                },
                hlcTimestamp: TEST_HLC,
              },
            },
          ],
        };

        // Capture console errors to keep test output clean
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        yield* handlePush(invalidPush, { ...mockUser, id: schemaUserId }, db, "OWNER");

        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining("Mutation FAILED: createBlock")
        );

        const block = yield* Effect.promise(() =>
          db.selectFrom("block").select("id").where("id", "=", blockId).executeTakeFirst()
        );
        
        expect(block).toBeUndefined();

        errorSpy.mockRestore();
      })
    );
  });
});
