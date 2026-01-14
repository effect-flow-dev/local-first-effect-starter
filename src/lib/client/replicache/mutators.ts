// FILE: src/lib/client/replicache/mutators.ts
import { createNote, updateNote, deleteNote, revertNote } from "./mutators/note";
import { createNotebook, deleteNotebook } from "./mutators/notebook";
import { 
  updateTask, 
  updateBlock, 
  revertBlock, 
  createBlock, 
  incrementCounter, 
  deleteBlock // ✅ Import this
} from "./mutators/block";

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
  incrementCounter,
  revertBlock,
  deleteBlock, // ✅ Register this
};

export type ReplicacheMutators = typeof mutators;
