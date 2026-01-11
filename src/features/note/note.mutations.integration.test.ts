// File: src/features/note/note.mutations.integration.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { handleCreateNote, handleCreateBlock, handleUpdateBlock } from "./note.mutations";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import type { UserId, NoteId, BlockId } from "../../lib/shared/schemas";
import type { TaskId } from "../../types/generated/tenant/tenant_template/Task";
import { randomUUID } from "node:crypto";
import type { Database } from "../../types";
import type { Kysely } from "kysely";

const TEST_HLC = "1736612345000:0001:TEST";

describe("Note Mutations (Integration)", () => {
    let db: Kysely<Database>;
    let cleanup: () => Promise<void>;
    let validUserId: UserId;

    afterAll(async () => {
        await closeTestDb();
    });

    beforeEach(async () => {
        const userId = randomUUID() as UserId;
        validUserId = userId;
        const setup = await createTestUserSchema(userId);
        db = setup.db;
        cleanup = setup.cleanup;
        return async () => await cleanup();
    });

    const setupUser = Effect.gen(function* () {
        return validUserId;
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
                }, TEST_HLC); 

                const note = yield* Effect.promise(() =>
                    db
                        .selectFrom("note")
                        .selectAll()
                        .where("id", "=", noteId)
                        .executeTakeFirst(),
                );

                expect(note).toBeDefined();
                expect(note?.title).toBe("Integration Note");
                expect(note?.global_version).toBe(TEST_HLC);
            }),
        );
    });

    it("handleCreateBlock should append blocks to the end of the note and log history", async () => {
        await Effect.runPromise(
            Effect.gen(function* () {
                const userId = yield* setupUser;
                const noteId = randomUUID() as NoteId;
                const blockHlc = "1736612346000:0001:TEST";

                yield* handleCreateNote(db, {
                    id: noteId,
                    userID: userId,
                    title: "Block Ordering Test",
                }, TEST_HLC); 

                const block1Id = randomUUID() as BlockId;

                yield* handleCreateBlock(db, {
                    noteId,
                    blockId: block1Id,
                    type: "tiptap_text",
                    content: "Block 1",
                    fields: { key: "foo", value: "bar" }
                } as any, userId, blockHlc); 

                const block = yield* Effect.promise(() =>
                    db.selectFrom("block")
                        .selectAll()
                        .where("id", "=", block1Id)
                        .executeTakeFirstOrThrow()
                );

                expect(block.global_version).toBe(blockHlc);
                expect(block.order).toBeGreaterThan(0); 

                const history = yield* Effect.promise(() =>
                    db.selectFrom("block_history")
                      .selectAll()
                      .where("block_id", "=", block1Id)
                      .executeTakeFirstOrThrow()
                );

                expect(history.hlc_timestamp).toBe(blockHlc);
                expect(history.mutation_type).toBe("createBlock");
            })
        );
    });

    it("should persist latitude and longitude when creating blocks", async () => {
        await Effect.runPromise(
            Effect.gen(function* () {
                const userId = yield* setupUser;
                const noteId = randomUUID() as NoteId;
                const blockId = randomUUID() as BlockId;

                yield* handleCreateNote(db, {
                    id: noteId,
                    userID: userId,
                    title: "Geo Test",
                }, TEST_HLC); 

                yield* handleCreateBlock(db, {
                    noteId,
                    blockId,
                    type: "form_meter",
                    fields: { value: 50, min: 0, max: 100, label: "Pressure", unit: "psi" },
                    latitude: -33.8688,
                    longitude: 151.2093
                }, userId, "1736612346000:0001:TEST"); 

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

    it("should propagate 'due_at' field from Block JSON to Task Table", async () => {
        await Effect.runPromise(
            Effect.gen(function* () {
                const userId = yield* setupUser;
                const noteId = randomUUID() as NoteId;
                const blockId = randomUUID() as BlockId;
                const futureDate = new Date("2030-01-01T12:00:00Z");

                yield* handleCreateNote(db, {
                    id: noteId,
                    userID: userId,
                    title: "Alert Test",
                }, TEST_HLC); 

                yield* handleCreateBlock(db, {
                    noteId,
                    blockId,
                    type: "task", 
                    fields: { status: "todo", is_complete: false, due_at: undefined },
                }, userId, "1736612346000:0001:TEST"); 

                yield* Effect.promise(() => db.insertInto("task")
                    .values({
                        id: randomUUID() as TaskId,
                        user_id: userId,
                        source_block_id: blockId,
                        content: "Task Content",
                        is_complete: false,
                        created_at: new Date(),
                        updated_at: new Date(),
                        global_version: TEST_HLC
                    })
                    .execute()
                );

                yield* handleUpdateBlock(db, {
                    blockId,
                    fields: { due_at: futureDate.toISOString() },
                    version: 1,
                }, userId, "1736612347000:0001:TEST"); 

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
