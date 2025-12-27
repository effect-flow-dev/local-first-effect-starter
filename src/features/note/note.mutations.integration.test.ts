// FILE: src/features/note/note.mutations.integration.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { handleCreateNote, handleCreateBlock, handleUpdateBlock } from "./note.mutations";
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

    // Verify block creation order
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
                    content: "Block 1",
                    fields: { key: "foo", value: "bar" } // ✅ Strict Text Args
                }, userId);

                // 3. Add Block 2
                yield* handleCreateBlock(db, {
                    noteId,
                    blockId: block2Id,
                    type: "form_checklist",
                    fields: { items: [] } // ✅ Strict Checklist Args
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

                expect(blocks[1]!.id).toBe(block1Id);
                expect(blocks[1]!.order).toBeGreaterThan(blocks[0]!.order);

                expect(blocks[2]!.id).toBe(block2Id);
                expect(blocks[2]!.order).toBeGreaterThan(blocks[1]!.order);
                expect(blocks[2]!.type).toBe("form_checklist");
            })
        );
    });

    // Verify Geolocation Persistence
    it("should persist latitude and longitude when creating blocks", async () => {
        await Effect.runPromise(
            Effect.gen(function* () {
                const userId = yield* setupUser;
                const noteId = randomUUID() as NoteId;
                const blockId = randomUUID() as BlockId;

                // 1. Create Note
                yield* handleCreateNote(db, {
                    id: noteId,
                    userID: userId,
                    title: "Geo Test",
                });

                // 2. Add Block with Coords
                yield* handleCreateBlock(db, {
                    noteId,
                    blockId,
                    type: "form_meter",
                    // ✅ Strict Meter Args
                    fields: { value: 50, min: 0, max: 100, label: "Pressure", unit: "psi" },
                    latitude: -33.8688,
                    longitude: 151.2093
                }, userId);

                // 3. Verify in DB
                const block = yield* Effect.promise(() =>
                    db.selectFrom("block")
                        .select(["latitude", "longitude"])
                        .where("id", "=", blockId)
                        .executeTakeFirstOrThrow()
                );

                expect(block.latitude).toBeCloseTo(-33.8688);
                expect(block.longitude).toBeCloseTo(151.2093);
            })
        );
    });

    // Verify Alert Propagation
    it("should propagate 'due_at' field from Block JSON to Task Table", async () => {
        await Effect.runPromise(
            Effect.gen(function* () {
                const userId = yield* setupUser;
                const noteId = randomUUID() as NoteId;
                const blockId = randomUUID() as BlockId;
                const futureDate = new Date("2030-01-01T12:00:00Z");

                // 1. Create Note & Task Block
                yield* handleCreateNote(db, {
                    id: noteId,
                    userID: userId,
                    title: "Alert Test",
                });

                yield* handleCreateBlock(db, {
                    noteId,
                    blockId,
                    type: "task", 
                    // ✅ Strict Task Args
                    fields: { status: "todo", is_complete: false, due_at: undefined },
                }, userId);

                // 2. Ensure Task Record exists
                yield* Effect.promise(() => db.insertInto("task")
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .values({
                        id: randomUUID(),
                        user_id: userId,
                        source_block_id: blockId,
                        content: "Task Content",
                        is_complete: false,
                        created_at: new Date(),
                        updated_at: new Date()
                    } as any)
                    .execute()
                );

                // 3. Update Block with due_at
                yield* handleUpdateBlock(db, {
                    blockId,
                    fields: { due_at: futureDate.toISOString() },
                    version: 1,
                }, userId);

                // 4. Verify Task Table Update
                const task = yield* Effect.promise(() =>
                    db.selectFrom("task")
                        .select("due_at")
                        .where("source_block_id", "=", blockId)
                        .executeTakeFirstOrThrow()
                );

                expect(task.due_at).toBeDefined();
                expect(new Date(task.due_at!).toISOString()).toBe(futureDate.toISOString());
            })
        );
    });
});
