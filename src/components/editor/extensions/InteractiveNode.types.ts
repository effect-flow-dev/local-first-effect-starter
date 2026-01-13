// FILE: src/components/editor/extensions/InteractiveNode.types.ts
import type { Node as ProsemirrorNode } from "@tiptap/pm/model";

export interface InteractiveNodeAttributes {
  blockId: string | null;
  // Updated block types including 'file_attachment'
  blockType: 
    | "text" 
    | "task" 
    | "image" 
    | "form_checklist" 
    | "form_meter" 
    | "map_block" 
    | "tiptap_text"
    | "file_attachment"; // ✅ Added
  version?: number;
  fields: {
    is_complete?: boolean;
    status?: "todo" | "in_progress" | "done" | "blocked"; 
    due_at?: string;
    url?: string;
    uploadId?: string;
    width?: number;
    caption?: string;
    // Checklist/Meter/Map fields
    items?: unknown;
    value?: number;
    min?: number;
    max?: number;
    unit?: string;
    label?: string;
    zoom?: number;
    style?: string;
    validation_status?: string;
    // ✅ NEW: File fields
    filename?: string;
    size?: number;
    mimeType?: string;
  };
}

export interface BlockFieldUpdateDetail {
  blockId: string;
  key: string;
  value: unknown;
}

export type InteractiveProsemirrorNode = ProsemirrorNode & {
  attrs: InteractiveNodeAttributes;
};
