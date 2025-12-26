// FILE: src/lib/client/replicache/mutators.ts
import { createNote, updateNote, deleteNote, revertNote } from "./mutators/note";
import { createNotebook, deleteNotebook } from "./mutators/notebook";
import { updateTask, updateBlock, revertBlock, createBlock } from "./mutators/block"; // ✅ Added createBlock

export const mutators = {
  createNote,
  updateNote,
  deleteNote,
  revertNote,
  createNotebook,
  deleteNotebook,
  updateTask,
  updateBlock,
  createBlock, // ✅ Added
  revertBlock,
};

export type ReplicacheMutators = typeof mutators;
