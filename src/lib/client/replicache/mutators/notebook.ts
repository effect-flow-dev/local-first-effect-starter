// FILE: src/lib/client/replicache/mutators/notebook.ts
import type { WriteTransaction, ReadonlyJSONValue } from "replicache";
import type { NotebookId, UserId } from "../../../shared/schemas";
import type { NoteStructure } from "./types";

export const createNotebook = async (
  tx: WriteTransaction,
  args: { id: NotebookId; name: string; userID: UserId },
) => {
  const now = new Date();
  const newNotebook = {
    _tag: "notebook",
    id: args.id,
    user_id: args.userID,
    name: args.name,
    created_at: now.toISOString(),
  };
  await tx.set(
    `notebook/${args.id}`,
    newNotebook as unknown as ReadonlyJSONValue,
  );
};

export const deleteNotebook = async (
  tx: WriteTransaction,
  args: { id: NotebookId },
) => {
  await tx.del(`notebook/${args.id}`);

  const notes = await tx.scan({ prefix: "note/" }).values().toArray();
  for (const noteJson of notes) {
    const note = noteJson as unknown as NoteStructure;
    if (note.notebook_id === args.id) {
      await tx.set(`note/${note.id}`, {
        ...note,
        notebook_id: null,
        updated_at: new Date().toISOString(),
      } as unknown as ReadonlyJSONValue);
    }
  }
};
