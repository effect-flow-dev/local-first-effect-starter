// FILE: src/features/note/mutations/block.ts
import { Effect, Schema } from "effect";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError, VersionConflictError } from "../Errors";
import { getNextGlobalVersion } from "../../replicache/versioning";
import { logBlockHistory, markHistoryRejected } from "../history.utils";
import { updateBlockInContent, revertBlockInContent } from "../utils/content-traversal";
import { 
    UpdateBlockArgsSchema, 
    RevertBlockArgsSchema, 
    CreateBlockArgsSchema, 
    IncrementCounterArgsSchema 
} from "../note.schemas";
import type { UserId } from "../../../lib/shared/schemas";

interface ContentNode {
    type: string;
    attrs?: {
        blockId?: string;
        version?: number;
        fields?: Record<string, unknown>;
        [key: string]: unknown;
    };
    content?: ContentNode[];
}

export const handleCreateBlock = (
    db: Kysely<Database> | Transaction<Database>,
    args: Schema.Schema.Type<typeof CreateBlockArgsSchema>,
    userId: UserId,
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(`[handleCreateBlock] Creating block ${args.blockId} in note ${args.noteId}`);
        const globalVersion = yield* getNextGlobalVersion(db);

        const maxOrderRow = yield* Effect.tryPromise({
            try: () =>
                db.selectFrom("block")
                    .select(db.fn.max("order").as("maxOrder"))
                    .where("note_id", "=", args.noteId)
                    .executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        const nextOrder = (maxOrderRow?.maxOrder ?? 0) + 1;

        yield* Effect.tryPromise({
            try: () =>
                db.insertInto("block")
                    .values({
                        id: args.blockId,
                        note_id: args.noteId,
                        user_id: userId,
                        type: args.type,
                        content: args.content ?? "",
                        fields: JSON.stringify(args.fields || {}),
                        order: nextOrder,
                        depth: 0,
                        file_path: "",
                        tags: [],
                        links: [],
                        transclusions: [],
                        version: 1,
                        created_at: sql<Date>`now()`,
                        updated_at: sql<Date>`now()`,
                        global_version: String(globalVersion),
                        latitude: args.latitude ?? null,
                        longitude: args.longitude ?? null,
                        device_created_at: args.deviceCreatedAt ?? null,
                        parent_id: null
                    })
                    .execute(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        yield* logBlockHistory(db, {
            blockId: args.blockId,
            noteId: args.noteId,
            userId: userId,
            mutationType: "createBlock",
            args: args
        });
    });

export const handleUpdateBlock = (
    db: Kysely<Database> | Transaction<Database>,
    args: Schema.Schema.Type<typeof UpdateBlockArgsSchema>,
    userId: UserId,
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(`[handleUpdateBlock] Updating block ${args.blockId}`);
        const globalVersion = yield* getNextGlobalVersion(db);

        const blockRow = yield* Effect.tryPromise({
            try: () => db.selectFrom("block")
                .select(["note_id", "version", "type", "fields"])
                .where("id", "=", args.blockId)
                .executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        if (!blockRow) {
            yield* Effect.logWarning(`[handleUpdateBlock] Block ${args.blockId} not found.`);
            return;
        }

        let historyId: string | null = null;
        if (blockRow?.note_id) {
            historyId = yield* logBlockHistory(db, {
                blockId: args.blockId,
                noteId: blockRow.note_id,
                userId: userId,
                mutationType: "updateBlock",
                args: args
            });
        }

        const currentVersion = blockRow?.version ?? 1;
        if (args.version !== currentVersion) {
            yield* Effect.logWarning(`[handleUpdateBlock] Version Conflict!`);
            if (historyId) yield* markHistoryRejected(db, historyId);
            return yield* Effect.fail(new VersionConflictError({
                blockId: args.blockId,
                expectedVersion: currentVersion,
                actualVersion: args.version
            }));
        }

        // --- SMART CHECK: Deferred Validation ---
        let validationWarning: string | undefined = undefined;
        let validationStatus: 'warning' | null = null;

        if (blockRow.type === "form_meter") {
            const currentFields = (blockRow.fields as Record<string, unknown>) || {};
            const mergedFields = { ...currentFields, ...args.fields };
            
            const val = Number(mergedFields.value);
            const min = Number(mergedFields.min ?? 0);
            const max = Number(mergedFields.max ?? 100);

            if (!isNaN(val) && (val < min || val > max)) {
                validationWarning = `Input ${val} is outside expected range (${min}-${max}). Please review.`;
                validationStatus = 'warning';
                yield* Effect.logInfo(`[SmartCheck] Flagged meter ${args.blockId}: ${validationWarning}`);
            }
        }

        const fieldsToSave = { 
            ...args.fields,
            validation_status: validationStatus 
        };

        if (blockRow?.note_id) {
            const noteRow = yield* Effect.tryPromise({
                try: () => db.selectFrom("note").select(["id", "content"]).where("id", "=", blockRow.note_id!).executeTakeFirst(),
                catch: (cause) => new NoteDatabaseError({ cause }),
            });

            if (noteRow && noteRow.content) {
                const content = JSON.parse(JSON.stringify(noteRow.content)) as ContentNode;
                if (updateBlockInContent(content, args.blockId, fieldsToSave, validationWarning)) {
                    yield* Effect.tryPromise({
                        try: () => db.updateTable("note").set({
                            content: content as unknown,
                            version: sql<number>`version + 1`,
                            updated_at: sql<Date>`now()`,
                            global_version: String(globalVersion),
                        }).where("id", "=", noteRow.id).execute(),
                        catch: (cause) => new NoteDatabaseError({ cause }),
                    });
                }
            }
        }

        yield* Effect.tryPromise({
            try: () => db.updateTable("block").set({
                fields: sql`fields || ${JSON.stringify(fieldsToSave)}::jsonb`,
                version: sql<number>`version + 1`,
                updated_at: sql<Date>`now()`,
                global_version: String(globalVersion),
            }).where("id", "=", args.blockId).execute(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        if (args.fields && 'due_at' in args.fields) {
            yield* Effect.tryPromise({
                try: () =>
                    db.updateTable("task")
                        // @ts-expect-error Kysely codegen update pending
                        .set({ due_at: args.fields.due_at ? args.fields.due_at : null })
                        .where("source_block_id", "=", args.blockId)
                        .execute(),
                catch: (cause) => new NoteDatabaseError({ cause }),
            });
        }
    });

export const handleRevertBlock = (
    db: Kysely<Database> | Transaction<Database>,
    args: Schema.Schema.Type<typeof RevertBlockArgsSchema>,
    userId: UserId
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(`[handleRevertBlock] Reverting block ${args.blockId} to history ${args.historyId}`);
        const globalVersion = yield* getNextGlobalVersion(db);

        const blockRow = yield* Effect.tryPromise({
            try: () => db.selectFrom("block").select("note_id").where("id", "=", args.blockId).executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        if (!blockRow) {
            yield* Effect.logWarning(`[handleRevertBlock] Block ${args.blockId} not found.`);
            return;
        }

        const snapshot = args.targetSnapshot;

        yield* logBlockHistory(db, {
            blockId: args.blockId,
            noteId: blockRow.note_id!,
            userId: userId,
            mutationType: "revertBlock",
            args: { revertedTo: args.historyId, ...snapshot },
            snapshot: snapshot
        });

        const fieldsToRestore = (snapshot.fields && typeof snapshot.fields === 'object')
            ? JSON.stringify(snapshot.fields)
            : undefined;

        yield* Effect.tryPromise({
            try: () =>
                db.updateTable("block")
                    .set({
                        fields: fieldsToRestore,
                        version: sql<number>`version + 1`,
                        updated_at: sql<Date>`now()`,
                        global_version: String(globalVersion)
                    })
                    .where("id", "=", args.blockId)
                    .execute(),
            catch: (cause) => new NoteDatabaseError({ cause })
        });

        const noteRow = yield* Effect.tryPromise({
            try: () => db.selectFrom("note").select(["id", "content"]).where("id", "=", blockRow.note_id!).executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause })
        });

        if (noteRow && noteRow.content) {
            const content = JSON.parse(JSON.stringify(noteRow.content)) as ContentNode;
            if (revertBlockInContent(content, args.blockId, snapshot)) {
                yield* Effect.tryPromise({
                    try: () => db.updateTable("note").set({
                        content: content as unknown,
                        version: sql<number>`version + 1`,
                        updated_at: sql<Date>`now()`,
                        global_version: String(globalVersion),
                    }).where("id", "=", noteRow.id).execute(),
                    catch: (cause) => new NoteDatabaseError({ cause }),
                });
            }
        }
    });

// ✅ FIX: Ensure 3rd argument 'userId' is present
export const handleIncrementCounter = (
    db: Kysely<Database> | Transaction<Database>,
    args: Schema.Schema.Type<typeof IncrementCounterArgsSchema>,
    userId: UserId,
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(`[handleIncrementCounter] Block: ${args.blockId}, Key: ${args.key}, Delta: ${args.delta}`);
        const globalVersion = yield* getNextGlobalVersion(db);

        const blockRow = yield* Effect.tryPromise({
            try: () => db.selectFrom("block").select("note_id").where("id", "=", args.blockId).executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        if (!blockRow) {
            yield* Effect.logWarning(`[handleIncrementCounter] Block ${args.blockId} not found.`);
            return;
        }

        if (blockRow.note_id) {
            yield* logBlockHistory(db, {
                blockId: args.blockId,
                noteId: blockRow.note_id,
                userId: userId,
                mutationType: "incrementCounter",
                args: args
            });
        }

        yield* Effect.tryPromise({
            try: () =>
                sql`
                    UPDATE block 
                    SET 
                        fields = jsonb_set(
                            COALESCE(fields, '{}'::jsonb), 
                            ARRAY[${args.key}], 
                            to_jsonb(COALESCE((fields->>${args.key})::numeric, 0) + ${args.delta})
                        ),
                        version = version + 1,
                        updated_at = now(),
                        global_version = ${String(globalVersion)}
                    WHERE id = ${args.blockId}
                `.execute(db),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });
    });
