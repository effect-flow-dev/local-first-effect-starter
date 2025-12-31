// FILE: src/lib/client/replicache/mutators/note.ts
import type { WriteTransaction, ReadonlyJSONValue } from "replicache";
import { Schema, Effect } from "effect";
import { TreeFormatter, type ParseError } from "effect/ParseResult";
import { v4 as uuidv4 } from "uuid";
import {
    TiptapDocSchema,
    NoteSchema,
    type AppNote,
    type NoteId,
    type UserId,
    type TiptapDoc,
    type NotebookId,
} from "../../../shared/schemas";

export const createNote = async (
    tx: WriteTransaction,
    args: {
        id: NoteId;
        userID: UserId;
        title: string;
        initialBlockId?: string;
        notebookId?: NotebookId;
        latitude?: number;
        longitude?: number;
    },
): Promise<ReadonlyJSONValue> => {
    const now = new Date();
    const firstBlockId = args.initialBlockId || uuidv4();

    // 1. Create the Note (Legacy content structure for compatibility)
    const emptyContent: TiptapDoc = {
        type: "doc",
        content: [
            {
                type: "paragraph",
                attrs: { blockId: firstBlockId },
                content: [],
            },
        ],
    };
    const newNote = {
        id: args.id,
        user_id: args.userID,
        title: args.title,
        content: emptyContent,
        version: 1,
        created_at: now,
        updated_at: now,
        notebook_id: args.notebookId || null,
    };

    const jsonCompatibleNote = {
        ...newNote,
        content: Schema.encodeSync(TiptapDocSchema)(newNote.content),
        created_at: newNote.created_at.toISOString(),
        updated_at: newNote.updated_at.toISOString(),
        global_version: "0", // Optimistic
    };

    // 2. Create the Initial Block (Crucial for Block-based Architecture)
    // The UI relies on querying blocksByNoteId to render the editor.
    // We use 'undefined' for optional fields so JSON.stringify strips them,
    // which satisfies the Schema.optional() validator (missing key is OK, null is NOT).
    const newBlock = {
        id: firstBlockId,
        note_id: args.id,
        user_id: args.userID,
        type: "tiptap_text", // Default type
        content: "",
        fields: {},
        tags: [],
        links: [],
        transclusions: [],
        file_path: "",
        parent_id: null,
        depth: 0,
        order: 0,
        version: 1,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        global_version: "0", // Optimistic
        latitude: args.latitude,   // undefined if missing (stripped)
        longitude: args.longitude, // undefined if missing (stripped)
    };

    // 3. Write to Replicache
    await tx.set(`block/${firstBlockId}`, newBlock as unknown as ReadonlyJSONValue);
    await tx.set(`note/${newNote.id}`, jsonCompatibleNote as unknown as ReadonlyJSONValue);
    
    return jsonCompatibleNote as unknown as ReadonlyJSONValue;
};

export const updateNote = async (
    tx: WriteTransaction,
    args: {
        id: NoteId;
        title?: string;
        content?: TiptapDoc; 
        notebookId?: NotebookId | null;
    },
) => {
    const noteKey = `note/${args.id}`;
    const noteJSON = (await tx.get(noteKey)) as unknown;

    if (!noteJSON) {
        console.warn(`[Replicache] updateNote: Note ${args.id} not found locally.`);
        return;
    }

    try {
        const note = Schema.decodeUnknownSync(NoteSchema)(noteJSON);

        const nextNotebookId =
            args.notebookId === undefined ? note.notebook_id : args.notebookId;

        const updatedNote: AppNote = {
            ...note,
            title: args.title ?? note.title,
            content: args.content ?? note.content,
            version: note.version + 1,
            updated_at: new Date(),
            notebook_id: nextNotebookId,
        };

        const jsonCompatibleUpdate = {
            ...updatedNote,
            content: Schema.encodeSync(TiptapDocSchema)(updatedNote.content),
            created_at: updatedNote.created_at.toISOString(),
            updated_at: updatedNote.updated_at.toISOString(),
        };

        await tx.set(
            noteKey,
            jsonCompatibleUpdate as unknown as ReadonlyJSONValue,
        );
    } catch (error) {
        let msg = "Unknown error";
        if (
            error &&
            typeof error === "object" &&
            "_tag" in error &&
            (error as { _tag: unknown })._tag === "ParseError"
        ) {
            msg = Effect.runSync(TreeFormatter.formatError(error as ParseError));
        } else if (error instanceof Error) {
            msg = error.message;
        }
        console.error(`[Replicache] Failed to update note ${args.id}:`, msg);
        throw error;
    }
};

export const deleteNote = async (
    tx: WriteTransaction,
    { id }: { id: NoteId },
) => {
    // 1. Delete the Note
    await tx.del(`note/${id}`);

    // 2. Delete Associated Blocks (Cleanup)
    // Scan all blocks belonging to this note using the index to prevent orphans
    const blocks = await tx.scan({ indexName: "blocksByNoteId", prefix: id }).keys().toArray();
    for (const key of blocks) {
        // Index keys are [Secondary, Primary] -> [NoteId, BlockId]
        const blockId = (key as unknown as [string, string])[1];
        await tx.del(`block/${blockId}`);
    }
};

export const revertNote = async (
    tx: WriteTransaction,
    args: {
        noteId: NoteId;
        historyId: string;
        targetSnapshot: {
            title: string;
            content: TiptapDoc;
            notebookId?: NotebookId | null;
        };
    },
) => {
    await updateNote(tx, {
        id: args.noteId,
        title: args.targetSnapshot.title,
        content: args.targetSnapshot.content,
        notebookId: args.targetSnapshot.notebookId,
    });
};
