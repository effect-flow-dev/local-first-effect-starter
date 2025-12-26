// FILE: src/lib/client/replicache/mutators/types.ts

export interface TraversalNode {
  type: string;
  attrs?: {
    blockId?: string;
    version?: number;
    fields?: { is_complete?: boolean; [key: string]: unknown };
    [key: string]: unknown;
  };
  content?: TraversalNode[];
  [key: string]: unknown;
}

export interface NoteStructure {
  id: string;
  content?: { content?: TraversalNode[]; [key: string]: unknown };
  version?: number;
  updated_at?: string;
  [key: string]: unknown;
  notebook_id?: string | null;
}

export interface BlockStructure {
  fields?: { is_complete?: boolean; [key: string]: unknown };
  version?: number;
  updated_at?: string;
  [key: string]: unknown;
}
