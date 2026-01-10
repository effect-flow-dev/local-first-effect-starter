// File: src/features/note/mutations/create.ts
import { Effect, Schema } from "effect";
import { type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError } from "../Errors";
import { getNextGlobalVersion } from "../../replicache/versioning";
import { logBlockHistory } from "../history.utils";
import { CreateNoteArgsSchema } from "../note.schemas";
import {
    parseContentToBlocks,
    type ParsedBlock,
} from "../../../lib/shared/content-parser";
import type {
    TiptapDoc,
    TiptapParagraphNode,
    InteractiveBlock,
    BlockId,
} from "../../../lib/shared/schemas";
import { v4 as uuidv4 } from "uuid";

export const handleCreateNote = (
    db: Kysely<Database> | Transaction<Database>,
    args: Schema.Schema.Type<typeof CreateNoteArgsSchema>,
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(
            "[handleCreateNote] Mutation triggered for title: " + args.title,
        );

        const globalVersion = yield* getNextGlobalVersion(db);
        const deviceTime = args.deviceCreatedAt || new Date();

        let finalTitle = args.title;
        let counter = 2;
        let isChecking = true;

        while (isChecking) {
            const note = yield* Effect.tryPromise({
                try: () =>
                    db
                        .selectFrom("note")
                        .select("id")
                        .where("title", "=", finalTitle)
                        .executeTakeFirst(),
                catch: (cause) => new NoteDatabaseError({ cause }),
            });
            if (!note) {
                isChecking = false;
            } else {
                finalTitle = args.title + " (" + counter++ + ")";
                yield* Effect.logInfo(
                    "[handleCreateNote] Title collision found. Using incremented title: " +
                        finalTitle,
                );
            }
        }

        let content: TiptapDoc;
        let blocksToInsert: ParsedBlock[] = [];

        if (args.template && args.template.length > 0) {
            yield* Effect.logInfo(
                "[handleCreateNote] Building note from template items...",
            );
            const tiptapNodes: (TiptapParagraphNode | InteractiveBlock)[] = [];
            let order = 0;

            for (const item of args.template) {
                const blockId = uuidv4() as BlockId;

                // ✅ FIX: item is already typed via CreateNoteArgsSchema. No need for TemplateItemSchema import.
                blocksToInsert.push({
                    id: blockId,
                    note_id: args.id,
                    user_id: args.userID,
                    type: item.type,
                    content: item.content || "",
                    fields: (item.fields as Record<string, unknown>) || {},
                    tags: [],
                    links: [],
                    transclusions: [],
                    file_path: "",
                    depth: 0,
                    order: order++,
                    version: 1,
                    parent_id: null,
                });

                if (item.type === "tiptap_text") {
                    tiptapNodes.push({
                        type: "paragraph",
                        attrs: { blockId, version: 1 },
                        content: item.content
                            ? [{ type: "text", text: item.content }]
                            : [],
                    });
                } else {
                    tiptapNodes.push({
                        type: "interactiveBlock",
                        attrs: {
                            blockId,
                            version: 1,
                            blockType: item.type as InteractiveBlock["attrs"]["blockType"],
                            fields: item.fields as InteractiveBlock["attrs"]["fields"],
                        },
                    });
                }
            }
            content = { type: "doc", content: tiptapNodes };
        } else {
            yield* Effect.logInfo(
                "[handleCreateNote] No template. Initializing with default paragraph.",
            );
            const firstBlockId = args.initialBlockId || uuidv4();
            content = {
                type: "doc",
                content: [
                    { type: "paragraph", attrs: { blockId: firstBlockId }, content: [] },
                ],
            };
            blocksToInsert = parseContentToBlocks(args.id, args.userID, content);
        }

        yield* Effect.tryPromise({
            try: () =>
                db
                    .insertInto("note")
                    .values({
                        id: args.id,
                        title: finalTitle,
                        content: content as unknown,
                        user_id: args.userID,
                        version: 1,
                        created_at: new Date(),
                        updated_at: new Date(),
                        device_created_at: deviceTime,
                        global_version: String(globalVersion),
                        notebook_id: args.notebookId || null,
                    })
                    .execute(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        if (blocksToInsert.length > 0) {
            yield* Effect.logInfo(
                `[handleCreateNote] Persisting ${blocksToInsert.length} child blocks.`,
            );

            const enrichedBlocks = blocksToInsert.map((b) => ({
                ...b,
                created_at: new Date(),
                updated_at: new Date(),
                device_created_at: deviceTime,
                global_version: String(globalVersion),
                fields: JSON.stringify(b.fields),
                latitude: args.latitude ?? null,
                longitude: args.longitude ?? null,
            }));

            yield* Effect.tryPromise({
                try: () => db.insertInto("block").values(enrichedBlocks).execute(),
                catch: (cause) => new NoteDatabaseError({ cause }),
            });
        }

        yield* logBlockHistory(db, {
            blockId: args.id,
            noteId: args.id,
            userId: args.userID,
            mutationType: "createNote",
            args: args,
        });

        yield* Effect.logInfo("[handleCreateNote] Success.");
    });
