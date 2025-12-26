// FILE: src/lib/client/replicache/mutators/block.ts
import type { WriteTransaction, ReadonlyJSONValue } from "replicache";
import type { BlockId, NoteId, UserId } from "../../../shared/schemas";
import type { TraversalNode, NoteStructure, BlockStructure } from "./types";

export interface SerializedBlock {
  id: BlockId;
  note_id: NoteId;
  user_id: UserId;
  type: string;
  content: string;
  fields: Record<string, unknown>;
  order: number;
  depth: number;
  version: number;
  created_at: string;
  updated_at: string;
  global_version?: string;
  tags: string[];
  links: string[];
  transclusions: string[];
  file_path: string;
  parent_id: string | null;
  _tag: "block";
}

// Minimal interface for order calculation
interface BlockOrderPartial {
  note_id: string;
  order?: number;
}

export const createBlock = async (
  tx: WriteTransaction,
  args: {
    noteId: NoteId;
    blockId: BlockId;
    type: string;
    content?: string;
    fields?: Record<string, unknown>;
  }
) => {
  // 1. Calculate Order
  // ✅ FIX: Use strict type for scanned blocks to avoid unsafe access on 'any'
  const blocks = await tx.scan({ prefix: "block/" }).values().toArray();
  const noteBlocks = (blocks as unknown as BlockOrderPartial[]).filter(b => b.note_id === args.noteId);
  
  const maxOrder = noteBlocks.reduce((max: number, b) => Math.max(max, b.order || 0), 0);
  const nextOrder = maxOrder + 1;

  // 2. Create Block
  const now = new Date().toISOString();
  
  const note = await tx.get(`note/${args.noteId}`) as NoteStructure | undefined;
  // ✅ FIX: Access user_id safely via bracket or type assertion if NoteStructure defines it
  // NoteStructure usually has [key: string]: unknown, so direct access is safe but type is unknown.
  // Casting to string is required.
  const userId = (note && typeof note['user_id'] === 'string') 
    ? note['user_id'] 
    : "unknown-user";

  const newBlock: SerializedBlock = {
    _tag: "block",
    id: args.blockId,
    note_id: args.noteId,
    user_id: userId as UserId,
    type: args.type,
    content: args.content || "",
    fields: args.fields || {},
    order: nextOrder,
    depth: 0,
    version: 1,
    created_at: now,
    updated_at: now,
    tags: [],
    links: [],
    transclusions: [],
    file_path: "",
    parent_id: null
  };

  await tx.set(`block/${args.blockId}`, newBlock as unknown as ReadonlyJSONValue);
};

export const updateTask = async (
  tx: WriteTransaction,
  args: { blockId: BlockId; isComplete: boolean; version: number },
) => {
  if (!args.blockId) return;
  const notes = await tx.scan({ prefix: "note/" }).values().toArray();

  for (const noteJson of notes) {
    const note = noteJson as unknown as NoteStructure;
    if (!note.content || !Array.isArray(note.content.content)) continue;

    const hasBlock = (nodes: TraversalNode[]): boolean => {
      for (const node of nodes) {
        if (node.attrs?.blockId === args.blockId) return true;
        if (node.content && Array.isArray(node.content)) {
          if (hasBlock(node.content)) return true;
        }
      }
      return false;
    };

    if (hasBlock(note.content.content)) {
      const updatedNote = JSON.parse(JSON.stringify(note)) as NoteStructure;
      const updateNode = (nodes: TraversalNode[]): boolean => {
        for (const node of nodes) {
          if (node.attrs?.blockId === args.blockId) {
            if (!node.attrs.fields) node.attrs.fields = {};

            node.attrs.fields.is_complete = args.isComplete;
            node.attrs.version = args.version + 1;

            return true;
          }
          if (node.content && Array.isArray(node.content)) {
            if (updateNode(node.content)) return true;
          }
        }
        return false;
      };
      const didUpdate = updateNode(updatedNote.content!.content!);
      if (didUpdate) {
        updatedNote.updated_at = new Date().toISOString();
        updatedNote.version = (updatedNote.version || 0) + 1;
        await tx.set(
          `note/${updatedNote.id}`,
          updatedNote as unknown as ReadonlyJSONValue,
        );

        const blockKey = `block/${args.blockId}`;
        const blockJson = await tx.get(blockKey);
        if (blockJson) {
          const updatedBlock = JSON.parse(
            JSON.stringify(blockJson),
          ) as BlockStructure;
          if (!updatedBlock.fields) updatedBlock.fields = {};
          updatedBlock.fields.is_complete = args.isComplete;
          updatedBlock.version = args.version + 1;
          updatedBlock.updated_at = new Date().toISOString();
          await tx.set(blockKey, updatedBlock as unknown as ReadonlyJSONValue);
        }
      }
      return;
    }
  }
};

export const updateBlock = async (
  tx: WriteTransaction,
  args: {
    blockId: BlockId;
    fields: Record<string, unknown>;
    version: number;
  },
): Promise<boolean> => {
  if (!args.blockId) return false;
  const notes = await tx.scan({ prefix: "note/" }).values().toArray();

  for (const noteJson of notes) {
    const note = noteJson as unknown as NoteStructure;
    if (!note.content || !Array.isArray(note.content.content)) continue;

    const hasBlock = (nodes: TraversalNode[]): boolean => {
      for (const node of nodes) {
        if (node.attrs?.blockId === args.blockId) return true;
        if (node.content && Array.isArray(node.content)) {
          if (hasBlock(node.content)) return true;
        }
      }
      return false;
    };

    if (hasBlock(note.content.content)) {
      const updatedNote = JSON.parse(JSON.stringify(note)) as NoteStructure;
      const updateNode = (nodes: TraversalNode[]): boolean => {
        for (const node of nodes) {
          if (node.attrs?.blockId === args.blockId) {
            if (!node.attrs.fields) node.attrs.fields = {};
            node.attrs.fields = { ...node.attrs.fields, ...args.fields };
            node.attrs.version = args.version + 1;
            return true;
          }
          if (node.content && Array.isArray(node.content)) {
            if (updateNode(node.content)) return true;
          }
        }
        return false;
      };
      const didUpdate = updateNode(updatedNote.content!.content!);
      if (didUpdate) {
        updatedNote.updated_at = new Date().toISOString();
        updatedNote.version = (updatedNote.version || 0) + 1;
        await tx.set(
          `note/${updatedNote.id}`,
          updatedNote as unknown as ReadonlyJSONValue,
        );

        const blockKey = `block/${args.blockId}`;
        const blockJson = await tx.get(blockKey);
        if (blockJson) {
          const updatedBlock = JSON.parse(
            JSON.stringify(blockJson),
          ) as BlockStructure;
          if (!updatedBlock.fields) updatedBlock.fields = {};
          updatedBlock.fields = { ...updatedBlock.fields, ...args.fields };
          updatedBlock.version = args.version + 1;
          updatedBlock.updated_at = new Date().toISOString();
          await tx.set(blockKey, updatedBlock as unknown as ReadonlyJSONValue);
        }
        return true;
      }
      return false;
    }
  }
  return false;
};

export const revertBlock = async (
  tx: WriteTransaction,
  args: {
    blockId: BlockId;
    historyId: string;
    targetSnapshot: Record<string, unknown>;
  },
) => {
  const notes = await tx.scan({ prefix: "note/" }).values().toArray();

  for (const noteJson of notes) {
    const note = noteJson as unknown as NoteStructure;
    if (!note.content || !Array.isArray(note.content.content)) continue;

    const hasBlock = (nodes: TraversalNode[]): boolean => {
      for (const node of nodes) {
        if (node.attrs?.blockId === args.blockId) return true;
        if (node.content && Array.isArray(node.content)) {
          if (hasBlock(node.content)) return true;
        }
      }
      return false;
    };

    if (hasBlock(note.content.content)) {
      const updatedNote = JSON.parse(JSON.stringify(note)) as NoteStructure;

      const revertNode = (nodes: TraversalNode[]): boolean => {
        for (const node of nodes) {
          if (node.attrs?.blockId === args.blockId) {
            if (args.targetSnapshot.fields) {
              node.attrs.fields = args.targetSnapshot.fields as Record<
                string,
                unknown
              >;
            }
            node.attrs.version = (node.attrs.version || 0) + 1;
            return true;
          }
          if (node.content && Array.isArray(node.content)) {
            if (revertNode(node.content)) return true;
          }
        }
        return false;
      };

      const didUpdate = revertNode(updatedNote.content!.content!);
      if (didUpdate) {
        updatedNote.updated_at = new Date().toISOString();
        updatedNote.version = (updatedNote.version || 0) + 1;
        await tx.set(
          `note/${updatedNote.id}`,
          updatedNote as unknown as ReadonlyJSONValue,
        );

        const blockKey = `block/${args.blockId}`;
        const blockJson = await tx.get(blockKey);
        if (blockJson) {
          const updatedBlock = JSON.parse(
            JSON.stringify(blockJson),
          ) as BlockStructure;
          if (args.targetSnapshot.fields) {
            updatedBlock.fields = args.targetSnapshot.fields as Record<
              string,
              unknown
            >;
          }
          updatedBlock.version = (updatedBlock.version || 0) + 1;
          updatedBlock.updated_at = new Date().toISOString();
          await tx.set(blockKey, updatedBlock as unknown as ReadonlyJSONValue);
        }
      }
      return;
    }
  }
};
