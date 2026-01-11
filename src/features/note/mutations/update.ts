// File: src/features/note/mutations/update.ts
import { Effect } from "effect";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError } from "../Errors";
import { logBlockHistory } from "../history.utils";
import type { UpdateNoteArgsSchema, RevertNoteArgsSchema } from "../note.schemas";
import { parseContentToBlocks } from "../../../lib/shared/content-parser";
import { updateLinksForNote } from "../../../lib/server/LinkService";
import { syncTasksForNote } from "../../../lib/server/TaskService";
import { NoteTitleExistsError } from "../../../lib/shared/errors";
import type { BlockId, UserId } from "../../../lib/shared/schemas";

export const _applyNoteUpdate = (
    db: Kysely<Database> | Transaction<Database>,
    args: typeof UpdateNoteArgsSchema.Type,
    userId: UserId,
    globalVersion: string 
) => Effect.gen(function*() {
    const updatePayload: Record<string, unknown> = {
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        global_version: globalVersion, 
    };

    if (args.title !== undefined) updatePayload.title = args.title;
    if (args.notebookId !== undefined) updatePayload.notebook_id = args.notebookId;
    if (args.content !== undefined) updatePayload.content = args.content;

    const updateResult = yield* Effect.tryPromise({
        try: () =>
            db
                .updateTable("note")
                .set(updatePayload)
                .where("id", "=", args.id)
                .returning("updated_at")
                .execute(),
        catch: (cause) => new NoteDatabaseError({ cause }),
    });

    if (updateResult.length === 0) return;

    if (args.content) {
        const incomingBlocksDTO = parseContentToBlocks(args.id, userId, args.content);
        const incomingIds = incomingBlocksDTO.map((b) => b.id).filter((id): id is BlockId => id !== undefined);

        yield* Effect.tryPromise({
            try: async () => {
                if (incomingIds.length > 0) {
                    await sql`
                        INSERT INTO tombstone (entity_id, entity_type, deleted_at_version)
                        SELECT id, 'block', ${globalVersion} 
                        FROM block 
                        WHERE note_id = ${args.id} AND id NOT IN (${sql.join(incomingIds)})
                    `.execute(db);
                }

                await db.deleteFrom("block").where("note_id", "=", args.id).where("id", "not in", incomingIds).execute();

                for (const block of incomingBlocksDTO) {
                    await db.insertInto("block").values({
                        ...block,
                        version: block.version || 1, 
                        created_at: sql<Date>`now()`,
                        updated_at: sql<Date>`now()`,
                        global_version: globalVersion,
                    }).onConflict((oc) => oc.column("id").doUpdateSet({
                        content: block.content,
                        type: block.type,
                        fields: sql`COALESCE(block.fields, '{}'::jsonb) || ${JSON.stringify(block.fields)}::jsonb`,
                        tags: block.tags,
                        links: block.links,
                        parent_id: block.parent_id,
                        depth: block.depth,
                        order: block.order,
                        version: sql<number>`block.version + 1`,
                        updated_at: sql<Date>`now()`,
                        global_version: globalVersion,
                    })).execute();
                }
            },
            catch: (cause) => new NoteDatabaseError({ cause }),
        });

        yield* Effect.all([
            updateLinksForNote(db, args.id, userId),
            // ✅ FIXED: Added globalVersion argument
            syncTasksForNote(db, args.id, userId, globalVersion),
        ], { concurrency: "unbounded" });
    }
});

export const handleUpdateNote = (
    db: Kysely<Database> | Transaction<Database>,
    args: typeof UpdateNoteArgsSchema.Type,
    userId: UserId,
    globalVersion: string 
) =>
    Effect.gen(function* () {
        if (args.title) {
            const existingNote = yield* Effect.tryPromise({
                try: () => db.selectFrom("note").select("id").where("title", "=", args.title!).where("id", "!=", args.id).executeTakeFirst(),
                catch: (cause) => new NoteDatabaseError({ cause }),
            });
            if (existingNote) return yield* Effect.fail(new NoteTitleExistsError());
        }

        yield* _applyNoteUpdate(db, args, userId, globalVersion);

        yield* logBlockHistory(db, {
            blockId: args.id,
            noteId: args.id,
            userId: userId,
            mutationType: "updateNote",
            args: args,
            hlcTimestamp: globalVersion,
            deviceTimestamp: args.deviceTimestamp || new Date() 
        });
    });

export const handleRevertNote = (
    db: Kysely<Database> | Transaction<Database>,
    args: typeof RevertNoteArgsSchema.Type,
    userId: UserId,
    globalVersion: string 
) =>
    Effect.gen(function* () {
        const existingNote = yield* Effect.tryPromise({
            try: () => db.selectFrom("note").select("id").where("title", "=", args.targetSnapshot.title).where("id", "!=", args.noteId).executeTakeFirst(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });
      
        let titleToRestore = args.targetSnapshot.title;
        if (existingNote) titleToRestore = `${titleToRestore} (Restored)`;

        const updateArgs: typeof UpdateNoteArgsSchema.Type = {
            id: args.noteId,
            title: titleToRestore,
            content: args.targetSnapshot.content,
            notebookId: args.targetSnapshot.notebookId
        };

        yield* _applyNoteUpdate(db, updateArgs, userId, globalVersion);

        yield* logBlockHistory(db, {
            blockId: args.noteId,
            noteId: args.noteId,
            userId: userId,
            mutationType: "revertNote",
            args: { revertedTo: args.historyId, ...args.targetSnapshot },
            snapshot: args.targetSnapshot,
            hlcTimestamp: globalVersion,
            deviceTimestamp: args.deviceTimestamp || new Date()
        });
    });
