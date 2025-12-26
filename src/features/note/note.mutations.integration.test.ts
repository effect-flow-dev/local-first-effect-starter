// FILE: src/features/note/note.mutations.integration.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { handleCreateNote, handleCreateBlock } from "./note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import type { UserId, NoteId, BlockId } from "../../lib/shared/schemas";
import { randomUUID } from "node:crypto";
import type { Database } from "../../types";
import type { Kysely } from "kysely";

describe("Note Mutations (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    const setup = await createTestUserSchema(randomUUID());
    db = setup.db;
    cleanup = setup.cleanup;
    return async () => await cleanup();
  });

  const setupUser = Effect.gen(function* () {
    const userId = randomUUID() as UserId;
    return userId;
  });

  it("createNote should insert a new note", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = yield* setupUser;
        const noteId = randomUUID() as NoteId;

        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "Integration Note",
        });

        const note = yield* Effect.promise(() =>
          db
            .selectFrom("note")
            .selectAll()
            .where("id", "=", noteId)
            .executeTakeFirst(),
        );

        expect(note).toBeDefined();
        expect(note?.title).toBe("Integration Note");
      }),
    );
  });

  // ✅ NEW TEST: Verify block creation order
  it("handleCreateBlock should append blocks to the end of the note", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const userId = yield* setupUser;
        const noteId = randomUUID() as NoteId;

        // 1. Create Note (Creates 1 default block at order 0)
        yield* handleCreateNote(db, {
          id: noteId,
          userID: userId,
          title: "Block Ordering Test",
        });

        const block1Id = randomUUID() as BlockId;
        const block2Id = randomUUID() as BlockId;

        // 2. Add Block 1
        yield* handleCreateBlock(db, {
            noteId,
            blockId: block1Id,
            type: "tiptap_text",
            content: "Block 1"
        }, userId);

        // 3. Add Block 2
        yield* handleCreateBlock(db, {
            noteId,
            blockId: block2Id,
            type: "form_checklist",
            fields: { items: [] }
        }, userId);

        // 4. Verify Order
        const blocks = yield* Effect.promise(() => 
            db.selectFrom("block")
              .select(["id", "order", "type"])
              .where("note_id", "=", noteId)
              .orderBy("order", "asc")
              .execute()
        );

        expect(blocks).toHaveLength(3); // Default + 2 new
        
        // Default block (from createNote) is order 0.
        // We use ! because we verified length is 3.
        
        expect(blocks[1]!.id).toBe(block1Id);
        expect(blocks[1]!.order).toBeGreaterThan(blocks[0]!.order);
        
        expect(blocks[2]!.id).toBe(block2Id);
        expect(blocks[2]!.order).toBeGreaterThan(blocks[1]!.order);
        expect(blocks[2]!.type).toBe("form_checklist");
      })
    );
  });
});
