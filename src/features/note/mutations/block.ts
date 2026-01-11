// File: src/features/note/mutations/block.ts
import { Effect, Schema } from "effect";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError, VersionConflictError } from "../Errors";
import { logBlockHistory, markHistoryRejected } from "../history.utils";
import { updateBlockInContent, revertBlockInContent } from "../utils/content-traversal";
import { 
    UpdateBlockArgsSchema, 
    RevertBlockArgsSchema, 
    CreateBlockArgsSchema, 
    IncrementCounterArgsSchema 
} from "../note.schemas";
import { _syncTaskTable } from "./task"; 
import type { UserId, TiptapTextNode } from "../../../lib/shared/schemas";
import type { InteractiveBlock } from "../../../lib/shared/schemas";

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
    globalVersion: string 
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(`[handleCreateBlock] Block ${args.blockId}, HLC: ${globalVersion}`);
        const deviceTime = args.deviceTimestamp || new Date();

        const maxOrderRow = yield* Effect.tryPromise({
            try: () =>
                db.selectFrom("block")
                    .select(db.fn.max("order").as("maxOrder"))
                    .where("note_id", "=", args.noteId)
                    .executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        const nextOrder = (Number(maxOrderRow?.maxOrder) ?? 0) + 1;
        const fields = ("fields" in args && args.fields ? args.fields : {}) as unknown as Record<string, unknown>;

        yield* Effect.tryPromise({
            try: () =>
                db.insertInto("block")
                    .values({
                        id: args.blockId,
                        note_id: args.noteId,
                        user_id: userId,
                        type: args.type as string,
                        content: args.content ?? "",
                        fields: JSON.stringify(fields),
                        order: nextOrder,
                        depth: 0,
                        file_path: "",
                        tags: [],
                        links: [],
                        transclusions: [],
                        version: 1,
                        created_at: sql<Date>`now()`,
                        updated_at: sql<Date>`now()`,
                        global_version: globalVersion, 
                        latitude: args.latitude ?? null,
                        longitude: args.longitude ?? null,
                        device_created_at: deviceTime,
                        parent_id: null
                    })
                    .execute(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        const noteRow = yield* Effect.tryPromise({
            try: () => db.selectFrom("note").select(["id", "content"]).where("id", "=", args.noteId).executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause })
        });

        if (noteRow && noteRow.content) {
            const content = JSON.parse(typeof noteRow.content === "string" ? noteRow.content : JSON.stringify(noteRow.content)) as ContentNode;
            const doc = content;
            if (!doc.content) doc.content = [];

            let newNode: ContentNode;
            if (args.type === "tiptap_text") {
                 newNode = {
                    type: "paragraph",
                    attrs: { blockId: args.blockId, version: 1 },
                    content: args.content ? [{ type: "text", text: args.content } as TiptapTextNode] : []
                 };
            } else {
                 newNode = {
                    type: "interactiveBlock",
                    attrs: { 
                        blockId: args.blockId, 
                        blockType: args.type as InteractiveBlock["attrs"]["blockType"], 
                        version: 1, 
                        fields: fields as InteractiveBlock["attrs"]["fields"] 
                    }
                 };
            }
            doc.content.push(newNode);

            yield* Effect.tryPromise({
                try: () => db.updateTable("note")
                    .set({
                        content: JSON.stringify(doc),
                        version: sql<number>`version + 1`,
                        updated_at: sql<Date>`now()`,
                        global_version: globalVersion
                    })
                    .where("id", "=", args.noteId).execute(),
                catch: (cause) => new NoteDatabaseError({ cause }),
            });
        }

        yield* logBlockHistory(db, {
            blockId: args.blockId,
            noteId: args.noteId,
            userId: userId,
            mutationType: "createBlock",
            args: args,
            hlcTimestamp: globalVersion, 
            deviceTimestamp: deviceTime   
        });
    });

export const handleUpdateBlock = (
    db: Kysely<Database> | Transaction<Database>,
    args: Schema.Schema.Type<typeof UpdateBlockArgsSchema>,
    userId: UserId,
    globalVersion: string 
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(`[handleUpdateBlock] Block ${args.blockId}, HLC: ${globalVersion}`);
        const deviceTime = args.deviceTimestamp || new Date();

        const blockRow = yield* Effect.tryPromise({
            try: () => db.selectFrom("block")
                .select(["note_id", "version", "type", "fields"])
                .where("id", "=", args.blockId)
                .executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        if (!blockRow) return;

        const historyId = yield* logBlockHistory(db, {
            blockId: args.blockId,
            noteId: blockRow.note_id!,
            userId: userId,
            mutationType: "updateBlock",
            args: args,
            hlcTimestamp: globalVersion,
            deviceTimestamp: deviceTime
        });

        const currentVersion = blockRow?.version ?? 1;
        if (args.version !== currentVersion) {
            yield* markHistoryRejected(db, historyId);
            return yield* Effect.fail(new VersionConflictError({
                blockId: args.blockId,
                expectedVersion: currentVersion,
                actualVersion: args.version
            }));
        }

        let validationWarning: string | undefined = undefined;
        let validationStatus: "warning" | null = null;
        if (blockRow.type === "form_meter") {
            const currentFields = (blockRow.fields as Record<string, unknown>) || {};
            const mergedFields = { ...currentFields, ...args.fields };
            const val = Number(mergedFields.value);
            const min = Number(mergedFields.min ?? 0);
            const max = Number(mergedFields.max ?? 100);
            if (!isNaN(val) && (val < min || val > max)) {
                validationWarning = `Input ${val} outside range (${min}-${max}).`;
                validationStatus = "warning";
            }
        }

        const fieldsToSave = { ...args.fields, validation_status: validationStatus };

        if (blockRow?.note_id) {
            const noteRow = yield* Effect.tryPromise({
                try: () => db.selectFrom("note").select(["id", "content"]).where("id", "=", blockRow.note_id!).executeTakeFirst(),
                catch: (cause) => new NoteDatabaseError({ cause }),
            });

            if (noteRow && noteRow.content) {
                const content = JSON.parse(typeof noteRow.content === "string" ? noteRow.content : JSON.stringify(noteRow.content)) as ContentNode;
                if (updateBlockInContent(content, args.blockId, fieldsToSave, validationWarning)) {
                    yield* Effect.tryPromise({
                        try: () => db.updateTable("note").set({
                            content: JSON.stringify(content),
                            version: sql<number>`version + 1`,
                            updated_at: sql<Date>`now()`,
                            global_version: globalVersion,
                        }).where("id", "=", noteRow.id).execute(),
                        catch: (cause) => new NoteDatabaseError({ cause }),
                    });
                }
            }
        }

        if (blockRow.type === "task" || blockRow.type === "interactiveBlock") {
            yield* _syncTaskTable(db, args.blockId, {
                is_complete: args.fields["is_complete"] as boolean | undefined,
                due_at: args.fields["due_at"] as string | null | undefined
            }, globalVersion);
        }

        yield* Effect.tryPromise({
            try: () => db.updateTable("block").set({
                fields: sql`fields || ${JSON.stringify(fieldsToSave)}::jsonb`,
                version: sql<number>`version + 1`,
                updated_at: sql<Date>`now()`,
                global_version: globalVersion,
            }).where("id", "=", args.blockId).execute(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });
    });

export const handleRevertBlock = (
    db: Kysely<Database> | Transaction<Database>,
    args: Schema.Schema.Type<typeof RevertBlockArgsSchema>,
    userId: UserId,
    globalVersion: string 
) =>
    Effect.gen(function* () {
        const deviceTime = args.deviceTimestamp || new Date();
        const blockRow = yield* Effect.tryPromise({
            try: () => db.selectFrom("block").select(["note_id", "type"]).where("id", "=", args.blockId).executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        if (!blockRow) return;

        yield* logBlockHistory(db, {
            blockId: args.blockId,
            noteId: blockRow.note_id!,
            userId: userId,
            mutationType: "revertBlock",
            args: { revertedTo: args.historyId, ...args.targetSnapshot },
            snapshot: args.targetSnapshot,
            hlcTimestamp: globalVersion,
            deviceTimestamp: deviceTime
        });

        const fieldsToRestore = JSON.stringify(args.targetSnapshot["fields"] || {});

        yield* Effect.tryPromise({
            try: () =>
                db.updateTable("block").set({
                        fields: fieldsToRestore,
                        version: sql<number>`version + 1`,
                        updated_at: sql<Date>`now()`,
                        global_version: globalVersion
                    }).where("id", "=", args.blockId).execute(),
            catch: (cause) => new NoteDatabaseError({ cause })
        });

        if (blockRow.type === "task" || blockRow.type === "interactiveBlock") {
            const f = (args.targetSnapshot["fields"] as Record<string, unknown>) || {};
            yield* _syncTaskTable(db, args.blockId, {
                is_complete: f["is_complete"] as boolean | undefined,
                due_at: f["due_at"] as string | null | undefined
            }, globalVersion);
        }

        const noteRow = yield* Effect.tryPromise({
            try: () => db.selectFrom("note").select(["id", "content"]).where("id", "=", blockRow.note_id!).executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause })
        });

        if (noteRow && noteRow.content) {
            const content = JSON.parse(typeof noteRow.content === "string" ? noteRow.content : JSON.stringify(noteRow.content)) as ContentNode;
            if (revertBlockInContent(content, args.blockId, args.targetSnapshot)) {
                yield* Effect.tryPromise({
                    try: () => db.updateTable("note").set({
                        content: JSON.stringify(content),
                        version: sql<number>`version + 1`,
                        updated_at: sql<Date>`now()`,
                        global_version: globalVersion,
                    }).where("id", "=", noteRow.id).execute(),
                    catch: (cause) => new NoteDatabaseError({ cause }),
                });
            }
        }
    });

export const handleIncrementCounter = (
    db: Kysely<Database> | Transaction<Database>,
    args: Schema.Schema.Type<typeof IncrementCounterArgsSchema>,
    userId: UserId,
    globalVersion: string 
) =>
    Effect.gen(function* () {
        const deviceTime = args.deviceTimestamp || new Date();
        const blockRow = yield* Effect.tryPromise({
            try: () => db.selectFrom("block").select("note_id").where("id", "=", args.blockId).executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        if (!blockRow) return;

        yield* logBlockHistory(db, {
            blockId: args.blockId,
            noteId: blockRow.note_id!,
            userId: userId,
            mutationType: "incrementCounter",
            args: args,
            hlcTimestamp: globalVersion,
            deviceTimestamp: deviceTime
        });

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
                        global_version = ${globalVersion}
                    WHERE id = ${args.blockId}
                `.execute(db),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });
    });
