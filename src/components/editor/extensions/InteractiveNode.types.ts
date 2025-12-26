// FILE: src/components/editor/extensions/InteractiveNode.types.ts
import type { Node as ProsemirrorNode } from "@tiptap/pm/model";

export interface InteractiveNodeAttributes {
  blockId: string | null;
  blockType: "text" | "task" | "image";
  version?: number;
  fields: {
    is_complete?: boolean;
    status?: "todo" | "in_progress" | "done" | "blocked"; 
    url?: string;
    uploadId?: string;
    width?: number;
    caption?: string;
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
