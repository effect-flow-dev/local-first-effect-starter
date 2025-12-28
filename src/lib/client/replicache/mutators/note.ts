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
    };

    await tx.set(
        `note/${newNote.id}`,
        jsonCompatibleNote as unknown as ReadonlyJSONValue,
    );
    return jsonCompatibleNote as unknown as ReadonlyJSONValue;
};

export const updateNote = async (
    tx: WriteTransaction,
    args: {
        id: NoteId;
        title?: string; // ✅ Made Optional
        content?: TiptapDoc; // ✅ Made Optional
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
            title: args.title ?? note.title,     // ✅ Merge existing if undefined
            content: args.content ?? note.content, // ✅ Merge existing if undefined
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
    await tx.del(`note/${id}`);
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
