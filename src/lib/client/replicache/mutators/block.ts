// FILE: src/lib/client/replicache/mutators/block.ts
import { Schema } from "effect";
import type { WriteTransaction, ReadonlyJSONValue } from "replicache";
import { 
    type BlockId, 
    type NoteId, 
    type UserId, 
    CreateBlockArgsSchema 
} from "../../../shared/schemas"; 
import type { TraversalNode, NoteStructure, BlockStructure } from "./types";
import { clientLog } from "../../clientLog"; // ✅ For logging
import { runClientUnscoped } from "../../runtime"; // ✅ For logging

export interface SerializedBlock {
    id: BlockId;
    note_id: NoteId;
    user_id: UserId;
    type: string;
    content: string; // JSON string for tiptap_text
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
    latitude?: number;
    longitude?: number;
    device_created_at?: string;
    _tag: "block";
}

interface BlockOrderPartial {
    note_id: string;
    order?: number;
}

export const createBlock = async (
    tx: WriteTransaction,
    args: Schema.Schema.Type<typeof CreateBlockArgsSchema>
) => {
    const validatedArgs = Schema.decodeUnknownSync(CreateBlockArgsSchema)(args);

    const blocks = await tx.scan({ prefix: "block/" }).values().toArray();
    const noteBlocks = (blocks as unknown as BlockOrderPartial[]).filter(b => b.note_id === validatedArgs.noteId);

    const maxOrder = noteBlocks.reduce((max: number, b) => Math.max(max, b.order || 0), 0);
    const nextOrder = maxOrder + 1;

    const now = new Date().toISOString();

    const note = await tx.get(`note/${validatedArgs.noteId}`) as NoteStructure | undefined;
    const userId = (note && typeof note['user_id'] === 'string')
        ? note['user_id']
        : "unknown-user";

    const fields = (validatedArgs as { fields?: Record<string, unknown> }).fields || {};

    const newBlock: SerializedBlock = {
        _tag: "block",
        id: validatedArgs.blockId,
        note_id: validatedArgs.noteId,
        user_id: userId as UserId,
        type: validatedArgs.type,
        content: validatedArgs.content || "",
        fields: fields,
        order: nextOrder,
        depth: 0,
        version: 1,
        created_at: now,
        updated_at: now,
        tags: [],
        links: [],
        transclusions: [],
        file_path: "",
        parent_id: null,
        latitude: validatedArgs.latitude,
        longitude: validatedArgs.longitude,
        device_created_at: validatedArgs.deviceTimestamp instanceof Date 
            ? validatedArgs.deviceTimestamp.toISOString() 
            : undefined,
    };

    await tx.set(`block/${validatedArgs.blockId}`, newBlock as unknown as ReadonlyJSONValue);
};

// Helper: Check if block exists in tree (Read-Only)
const hasBlock = (nodes: readonly TraversalNode[], blockId: string): boolean => {
    for (const node of nodes) {
        if (node.attrs?.blockId === blockId) return true;
        if (node.content && Array.isArray(node.content)) {
            if (hasBlock(node.content, blockId)) return true;
        }
    }
    return false;
};

// Helper: Mutate the tree (Assumes 'nodes' is already a writable clone)
const updateNestedNode = (nodes: TraversalNode[], args: { blockId: string; fields: Record<string, unknown>; version: number }): boolean => {
    for (const node of nodes) {
        if (node.attrs?.blockId === args.blockId) {
            // Ensure attrs is an object we can write to (it should be if parent was cloned deeply)
            if (!node.attrs) node.attrs = {};
            if (!node.attrs.fields) node.attrs.fields = {};
            
            node.attrs.fields = { ...node.attrs.fields, ...args.fields };
            node.attrs.version = args.version + 1;
            return true;
        }
        if (node.content && Array.isArray(node.content)) {
            if (updateNestedNode(node.content, args)) return true;
        }
    }
    return false;
};

export const updateBlock = async (
    tx: WriteTransaction,
    args: {
        blockId: BlockId;
        fields: Record<string, unknown>;
        version: number;
        hlcTimestamp?: string;
        deviceTimestamp?: Date;
    },
): Promise<boolean> => {
    if (!args.blockId) return false;

    let found = false;

    // 1. Update Isolated Block
    const blockKey = `block/${args.blockId}`;
    const blockJson = await tx.get(blockKey);
    if (blockJson) {
        const updatedBlock = JSON.parse(JSON.stringify(blockJson)) as BlockStructure;
        if (!updatedBlock.fields) updatedBlock.fields = {};
        updatedBlock.fields = { ...updatedBlock.fields, ...args.fields };
        updatedBlock.version = args.version + 1;
        updatedBlock.updated_at = new Date().toISOString();
        await tx.set(blockKey, updatedBlock as unknown as ReadonlyJSONValue);
        found = true;
    }

    // 2. Update Note Content
    const notes = await tx.scan({ prefix: "note/" }).values().toArray();
    for (const noteJson of notes) {
        const note = noteJson as unknown as NoteStructure;
        
        if (note.content && typeof note.content === 'object' && Array.isArray(note.content.content)) {
             // READ-ONLY CHECK FIRST
             if (hasBlock(note.content.content, args.blockId)) {
                // CLONE BEFORE MUTATE
                const updatedNote = JSON.parse(JSON.stringify(note)) as NoteStructure;
                
                // Now it is safe to mutate
                if (updateNestedNode(updatedNote.content!.content as TraversalNode[], args)) {
                    updatedNote.updated_at = new Date().toISOString();
                    updatedNote.version = (updatedNote.version || 0) + 1;
                    await tx.set(`note/${updatedNote.id}`, updatedNote as unknown as ReadonlyJSONValue);
                    found = true;
                }
             }
        }
    }

    // 3. Update Tiptap Text Blocks
    const blocks = await tx.scan({ prefix: "block/" }).values().toArray();
    for (const b of blocks) {
        const block = b as unknown as SerializedBlock;
        if (block.type === "tiptap_text" && block.content) {
            try {
                // block.content is a JSON string. Parsing it creates a fresh object (implicitly cloned).
                // ✅ FIX: Explicit cast to safe type to avoid 'any' error
                const doc = JSON.parse(block.content) as { content?: TraversalNode[] };
                
                if (doc && Array.isArray(doc.content)) {
                    // We can mutate 'doc' directly since it's a new object from JSON.parse
                    // ✅ FIX: doc.content is now typed via the cast above
                    if (updateNestedNode(doc.content, args)) {
                         const updatedBlock = JSON.parse(JSON.stringify(block)) as SerializedBlock;
                         updatedBlock.content = JSON.stringify(doc); // Re-serialize mutated doc
                         
                         updatedBlock.updated_at = new Date().toISOString();
                         updatedBlock.version = (updatedBlock.version || 0) + 1;
                         
                         await tx.set(`block/${block.id}`, updatedBlock as unknown as ReadonlyJSONValue);
                         found = true;
                    }
                }
            } catch {
                // Ignore parse errors (unused 'e' removed)
            }
        }
    }

    return found;
};

export const updateTask = async (
    tx: WriteTransaction,
    args: { blockId: BlockId; isComplete: boolean; version: number; hlcTimestamp?: string; deviceTimestamp?: Date },
) => {
    if (!args.blockId) return;
    
    // 1. Update Isolated Block
    const blockKey = `block/${args.blockId}`;
    const blockJson = await tx.get(blockKey);
    if (blockJson) {
        const updatedBlock = JSON.parse(JSON.stringify(blockJson)) as BlockStructure;
        if (!updatedBlock.fields) updatedBlock.fields = {};
        updatedBlock.fields.is_complete = args.isComplete;
        updatedBlock.version = args.version + 1;
        updatedBlock.updated_at = new Date().toISOString();
        await tx.set(blockKey, updatedBlock as unknown as ReadonlyJSONValue);
    }
    
    // 2. Update Note Content
    const notes = await tx.scan({ prefix: "note/" }).values().toArray();
    for (const noteJson of notes) {
        const note = noteJson as unknown as NoteStructure;
        if (!note.content || !Array.isArray(note.content.content)) continue;

        if (hasBlock(note.content.content, args.blockId)) {
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
            
            if (updateNode(updatedNote.content!.content!)) {
                updatedNote.updated_at = new Date().toISOString();
                updatedNote.version = (updatedNote.version || 0) + 1;
                await tx.set(`note/${updatedNote.id}`, updatedNote as unknown as ReadonlyJSONValue);
            }
        }
    }
};

export const revertBlock = async (
    tx: WriteTransaction,
    args: {
        blockId: BlockId;
        historyId: string;
        targetSnapshot: Record<string, unknown>;
        hlcTimestamp?: string;
        deviceTimestamp?: Date;
    },
) => {
    const notes = await tx.scan({ prefix: "note/" }).values().toArray();

    for (const noteJson of notes) {
        const note = noteJson as unknown as NoteStructure;
        if (!note.content || !Array.isArray(note.content.content)) continue;

        if (hasBlock(note.content.content, args.blockId)) {
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

export const incrementCounter = async (
    tx: WriteTransaction,
    args: {
        blockId: BlockId;
        key: string;
        delta: number;
        version: number;
        hlcTimestamp?: string;
        deviceTimestamp?: Date;
    }
) => {
    const blockKey = `block/${args.blockId}`;
    const blockVal = await tx.get(blockKey);

    if (!blockVal) {
        return;
    }

    const block = JSON.parse(JSON.stringify(blockVal)) as SerializedBlock;
    const currentFields = block.fields || {};
    const oldVal = (typeof currentFields[args.key] === 'number')
        ? (currentFields[args.key] as number)
        : 0;
    
    const newVal = oldVal + args.delta;

    const updatedBlock = {
        ...block,
        fields: { ...currentFields, [args.key]: newVal },
        version: (block.version || 0) + 1,
        updated_at: new Date().toISOString()
    };

    await tx.set(blockKey, updatedBlock as unknown as ReadonlyJSONValue);

    if (block.note_id) {
        const noteKey = `note/${block.note_id}`;
        const noteVal = await tx.get(noteKey);
        
        if (noteVal) {
            const note = JSON.parse(JSON.stringify(noteVal)) as NoteStructure;
            if (note.content && Array.isArray(note.content.content)) {
                const updateNode = (nodes: TraversalNode[]): boolean => {
                    let changed = false;
                    for (const node of nodes) {
                        if (node.attrs?.blockId === args.blockId) {
                            if (!node.attrs.fields) node.attrs.fields = {};
                            node.attrs.fields[args.key] = newVal;
                            node.attrs.version = (node.attrs.version || 0) + 1;
                            changed = true;
                        }
                        if (node.content && Array.isArray(node.content)) {
                            if (updateNode(node.content)) changed = true;
                        }
                    }
                    return changed;
                };

                const changed = updateNode(note.content.content);
                if (changed) {
                    await tx.set(noteKey, {
                        ...note,
                        version: (note.version || 0) + 1,
                        updated_at: new Date().toISOString()
                    } as unknown as ReadonlyJSONValue);
                }
            }
        }
    }
};

// ✅ ADDED: Client-side deleteBlock
export const deleteBlock = async (
    tx: WriteTransaction,
    args: { blockId: BlockId; hlcTimestamp?: string; deviceTimestamp?: Date }
) => {
    runClientUnscoped(clientLog("info", `[Mutator:deleteBlock] Started for ${args.blockId}`));

    // 1. Delete standalone block entry
    await tx.del(`block/${args.blockId}`);

    // 2. Scan notes to remove from content tree (if embedded)
    // This handles both Tiptap editor content and interactiveBlock wrappers
    const notes = await tx.scan({ prefix: "note/" }).values().toArray();
    let updatedCount = 0;
    
    for (const noteJson of notes) {
        const note = noteJson as unknown as NoteStructure;
        
        if (note.content && Array.isArray(note.content.content)) {
             // Clone before mutate
             const clonedNote = JSON.parse(JSON.stringify(note)) as NoteStructure;
             let changed = false;

             const removeNode = (nodes: TraversalNode[]) => {
                 for (let i = 0; i < nodes.length; i++) {
                     const node = nodes[i];
                     if (node?.attrs?.blockId === args.blockId) {
                         nodes.splice(i, 1);
                         changed = true;
                         i--; // Adjust index after splice
                     } else if (node?.content && Array.isArray(node.content)) {
                         removeNode(node.content);
                     }
                 }
             };
             
             removeNode(clonedNote.content!.content!);
             
             if (changed) {
                 clonedNote.version = (clonedNote.version || 0) + 1;
                 clonedNote.updated_at = new Date().toISOString();
                 await tx.set(`note/${note.id}`, clonedNote as unknown as ReadonlyJSONValue);
                 updatedCount++;
             }
        }
    }
    
    runClientUnscoped(clientLog("info", `[Mutator:deleteBlock] Completed. Removed from ${updatedCount} notes.`));
};
