// FILE: src/lib/shared/content-parser.ts
import { v4 as uuidv4 } from "uuid";
import type {
  UserId,
  NoteId,
  BlockId,
  TiptapDoc,
  TiptapNode,
  TiptapParagraphNode,
  TiptapBulletListNode,
  TiptapListItemNode,
  TiptapHeadingNode,
  InteractiveBlock,
} from "./schemas";

export const TASK_REGEX = /^\s*(-\s*)?\[( |x)\]\s+(.*)/i;

// Regex for key::value pairs
// Matches: "key::value"
// Group 1: key (alphanumeric)
// Group 2: value (non-whitespace OR a complete [[wikilink]])
// This aligns with MetadataMark.ts which uses `[^,\s]` to define values as "pills".
export const METADATA_PARSER_REGEX = /(\w+)::\s*((?:\[\[[^\]]+\]\]|[^,\s])+)/g;

/**
 * Represents a parsed block structure ready for storage.
 * This is a neutral DTO used by both client (Replicache) and server (Kysely).
 */
export interface ParsedBlock {
  id: BlockId;
  note_id: NoteId;
  user_id: UserId;
  parent_id: BlockId | null;
  type: string;
  content: string;
  fields: Record<string, unknown>;
  tags: string[];
  links: string[];
  transclusions: string[];
  file_path: string;
  depth: number;
  order: number;
  version: number; 
}

type TraversableNode =
  | TiptapParagraphNode
  | TiptapBulletListNode
  | TiptapListItemNode
  | TiptapHeadingNode
  | InteractiveBlock;

/**
 * Parses a Tiptap document into a flat list of Block records.
 * This function is shared to ensure the client's optimistic cache
 * matches the server's eventual state, preventing UI flickering.
 */
export const parseContentToBlocks = (
  noteId: string,
  userId: string,
  contentJSON: TiptapDoc,
): ParsedBlock[] => {
  const parsedBlocks: ParsedBlock[] = [];

  // Helper to extract Links, Tags, and now Metadata Fields
  const extractMetadata = (
    content: readonly TiptapNode[] | undefined,
    fullText: string // We pass full text to run regex on the complete string
  ): { links: string[]; tags: string[]; fields: Record<string, unknown> } => {
    const links: string[] = [];
    const tags: string[] = [];
    const fields: Record<string, unknown> = {};

    // 1. Extract from Tiptap Marks (Visual/Explicit)
    if (content) {
      for (const node of content) {
        if (node.type === "text" && node.marks) {
          for (const mark of node.marks) {
            if (mark.type === "linkMark" && mark.attrs?.linkTarget) {
              links.push(mark.attrs.linkTarget);
            }
            if (mark.type === "tagMark" && mark.attrs?.tagName) {
              tags.push(mark.attrs.tagName);
            }
            if (mark.type === "metadataMark" && mark.attrs?.key && mark.attrs?.value) {
                fields[mark.attrs.key] = mark.attrs.value;
            }
          }
        }
      }
    }

    // 2. Extract from Text Regex (Server-side safety net & fallback)
    // This ensures that even if Tiptap marks aren't present (e.g. pasted text not yet hydrated),
    // we still capture the data fields in the DB.
    const matches = fullText.matchAll(METADATA_PARSER_REGEX);
    for (const match of matches) {
        const key = match[1];
        const value = match[2]?.trim();
        if (key && value) {
            fields[key] = value;
        }
    }

    return { links, tags, fields };
  };

  const traverseNodes = (
    nodes: ReadonlyArray<TraversableNode> | undefined,
    parentId: BlockId | null,
    depth: number,
  ) => {
    if (!nodes) return;

    let order = 0;

    for (const node of nodes) {
      if (node.type === "interactiveBlock") {
        const blockId =
          (node.attrs.blockId as BlockId) || (uuidv4() as BlockId);
        const version = node.attrs.version ?? 1;

        const textContent =
          node.content
            ?.map((t) => (t).text)
            .join("")
            .trim() ?? "";

        const { links, tags, fields: extractedFields } = extractMetadata(node.content, textContent);

        // Merge extracted fields with block attributes (e.g. status from task)
        const combinedFields = { ...(node.attrs.fields || {}), ...extractedFields };

        parsedBlocks.push({
          id: blockId,
          note_id: noteId as NoteId,
          user_id: userId as UserId,
          parent_id: parentId,
          type: node.attrs.blockType,
          content: textContent,
          depth,
          order: order++,
          fields: combinedFields,
          tags,
          links,
          transclusions: [],
          file_path: "",
          version, 
        });
      } else if (node.type === "bulletList" && node.content) {
        traverseNodes(node.content as TraversableNode[], parentId, depth);
      } else if (node.type === "listItem" && node.content) {
        const newBlockId =
          (node.attrs?.blockId as BlockId) || (uuidv4() as BlockId);
        const version = node.attrs?.version ?? 1;

        const paragraphNode = node.content.find(
          (n: TiptapNode): n is TiptapParagraphNode => n.type === "paragraph",
        );
        
        const textContent =
          paragraphNode?.content
            ?.map((t) => (t).text)
            .join("")
            .trim() || "";

        const { links, tags, fields } = extractMetadata(
          paragraphNode?.content,
          textContent
        );

        parsedBlocks.push({
          id: newBlockId,
          note_id: noteId as NoteId,
          user_id: userId as UserId,
          parent_id: parentId,
          type: "text",
          content: textContent,
          depth,
          order: order++,
          fields,
          tags,
          links,
          transclusions: [],
          file_path: "",
          version,
        });

        const nestedList = node.content.find(
          (n: TiptapNode): n is TiptapBulletListNode => n.type === "bulletList",
        );
        if (nestedList && nestedList.content) {
          traverseNodes(
            nestedList.content as TraversableNode[],
            newBlockId,
            depth + 1,
          );
        }
      } else if (node.type === "paragraph" || node.type === "heading") {
        const textContent =
          node.content
            ?.map((t) => (t).text)
            .join("")
            .trim() || "";

        const newBlockId =
          (node.attrs?.blockId as BlockId) || (uuidv4() as BlockId);
        const version = node.attrs?.version ?? 1;

        let blockType: "text" | "task" = "text";
        let fields: Record<string, unknown> = {};
        let finalContent = textContent;

        const taskMatch = textContent.match(TASK_REGEX);
        if (taskMatch) {
          blockType = "task";
          fields = {
            is_complete: taskMatch[2]?.toLowerCase() === "x",
          };
          finalContent = taskMatch[3] ?? "";
        }

        const { links, tags, fields: extractedFields } = extractMetadata(node.content, textContent);
        
        // Merge fields
        fields = { ...fields, ...extractedFields };

        parsedBlocks.push({
          id: newBlockId,
          note_id: noteId as NoteId,
          user_id: userId as UserId,
          parent_id: parentId,
          type: blockType,
          content: finalContent,
          depth,
          order: order++,
          fields,
          tags,
          links,
          transclusions: [],
          file_path: "",
          version,
        });
      }
    }
  };

  traverseNodes(contentJSON.content as TraversableNode[], null, 0);
  return parsedBlocks;
};
