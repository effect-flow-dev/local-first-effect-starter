// FILE: src/components/editor/extensions/InteractiveNode.types.ts
import type { Node as ProsemirrorNode } from "@tiptap/pm/model";

export interface InteractiveNodeAttributes {
  blockId: string | null;
  // Updated block types including 'map_block' and 'tiptap_text'
  blockType: "text" | "task" | "image" | "form_checklist" | "form_meter" | "map_block" | "tiptap_text";
  version?: number;
  fields: {
    is_complete?: boolean;
    status?: "todo" | "in_progress" | "done" | "blocked"; 
    // ✅ FIX: Add due_at for Task alerts
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
