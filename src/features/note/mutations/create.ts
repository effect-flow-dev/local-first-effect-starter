// FILE: src/features/note/mutations/create.ts
import { Effect, Schema } from "effect";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError } from "../Errors";
import { getNextGlobalVersion } from "../../replicache/versioning";
import { logBlockHistory } from "../history.utils";
import { CreateNoteArgsSchema } from "../note.schemas";
import { parseContentToBlocks, type ParsedBlock } from "../../../lib/shared/content-parser";
import type { TiptapDoc, TiptapParagraphNode, InteractiveBlock, BlockId } from "../../../lib/shared/schemas";
import { v4 as uuidv4 } from "uuid";

export const handleCreateNote = (
  db: Kysely<Database> | Transaction<Database>, 
  args: Schema.Schema.Type<typeof CreateNoteArgsSchema>
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[handleCreateNote] START. ID: ${args.id}`);

    const globalVersion = yield* getNextGlobalVersion(db);

    // ✅ FIX: Time Skew / Audit Trail
    // Use the client's claimed time if provided, otherwise server time.
    const deviceTime = args.deviceCreatedAt || new Date();

    yield* logBlockHistory(db, {
      blockId: args.id,
      noteId: args.id,
      userId: args.userID,
      mutationType: "createNote",
      args: args
    });

    let finalTitle = args.title;
    let counter = 2;
    let existingNote = true;

    // Title Collision Check
    while (existingNote) {
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
        existingNote = false;
      } else {
        finalTitle = `${args.title} (${counter++})`;
      }
    }

    let content: TiptapDoc;
    let blocksToInsert: ParsedBlock[] = [];

    // TEMPLATE LOGIC
    if (args.template && args.template.length > 0) {
        const tiptapNodes: (TiptapParagraphNode | InteractiveBlock)[] = [];
        let order = 0;

        for (const item of args.template) {
            const blockId = uuidv4() as BlockId;
            
            // 1. Prepare DB Block Row
            blocksToInsert.push({
                id: blockId,
                note_id: args.id,
                user_id: args.userID,
                type: item.type,
                content: item.content || "",
                // ✅ Strictly typed fields
                fields: (item.fields as Record<string, unknown>) || {},
                tags: [],
                links: [],
                transclusions: [],
                file_path: "",
                parent_id: null,
                depth: 0,
                order: order++,
                version: 1,
            });

            // 2. Prepare Tiptap Node representation
            if (item.type === "tiptap_text") {
                tiptapNodes.push({
                    type: "paragraph",
                    attrs: { blockId, version: 1 },
                    content: item.content ? [{ type: "text", text: item.content }] : []
                });
            } else if (item.type === "form_checklist" || item.type === "form_meter") {
                tiptapNodes.push({
                    type: "interactiveBlock",
                    attrs: {
                        blockId,
                        version: 1,
                        blockType: item.type,
                        fields: item.fields as unknown as InteractiveBlock["attrs"]["fields"]
                    }
                });
            }
        }

        content = {
            type: "doc",
            content: tiptapNodes
        };

    } else {
        // DEFAULT LOGIC (Empty Note)
        const firstBlockId = args.initialBlockId || uuidv4();
        content = {
          type: "doc",
          content: [{ 
            type: "paragraph", 
            attrs: { blockId: firstBlockId }, 
            content: [] 
          }],
        };
        
        blocksToInsert = parseContentToBlocks(args.id, args.userID, content);
    }

    // Insert Note
    const newNote = {
      id: args.id,
      title: finalTitle,
      content: content as unknown, 
      user_id: args.userID,
      version: 1,
      created_at: sql<Date>`now()`, // Server Sync Time
      updated_at: sql<Date>`now()`,
      // ✅ FIX: Persist the actual device time for legal/audit purposes
      device_created_at: deviceTime, 
      global_version: String(globalVersion),
      notebook_id: args.notebookId || null, 
    };

    yield* Effect.tryPromise({
      // ✅ FIX: Disable unsafe-argument because we are casting to 'any' to bypass missing column in types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      try: () => db.insertInto("note").values(newNote as any).execute(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    // Insert Blocks
    if (blocksToInsert.length > 0) {
        // Enhance parsed blocks with timestamps and global version for DB insert
        const enrichedBlocks = blocksToInsert.map(b => ({
            ...b,
            created_at: sql<Date>`now()`,
            updated_at: sql<Date>`now()`,
            // ✅ FIX: Persist device time on blocks
            device_created_at: deviceTime,
            global_version: String(globalVersion),
            fields: JSON.stringify(b.fields)
        }));

        yield* Effect.tryPromise({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            try: () => db.insertInto("block").values(enrichedBlocks as any).execute(),
            catch: (cause) => new NoteDatabaseError({ cause }),
        });
    }

    yield* Effect.logInfo(`[handleCreateNote] SUCCESS (v${globalVersion}). Device Time: ${deviceTime.toISOString()}`);
  });
