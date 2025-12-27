// FILE: src/lib/client/replicache/mutators.ts
import { createNote, updateNote, deleteNote, revertNote } from "./mutators/note";
import { createNotebook, deleteNotebook } from "./mutators/notebook";
import { updateTask, updateBlock, revertBlock, createBlock, incrementCounter } from "./mutators/block";

export const mutators = {
  createNote,
  updateNote,
  deleteNote,
  revertNote,
  createNotebook,
  deleteNotebook,
  updateTask,
  updateBlock,
  createBlock,
  incrementCounter, // ✅ Added
  revertBlock,
};

export type ReplicacheMutators = typeof mutators;
