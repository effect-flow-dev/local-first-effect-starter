// FILE: src/lib/client/logic/markdown-transformer.ts
import { generateHTML, generateJSON } from "@tiptap/html";
import type { JSONContent } from "@tiptap/core";
import TurndownService from "turndown";
import { marked } from "marked";
import type { TiptapDoc } from "../../shared/schemas";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";
import { headlessExtensions } from "../../../components/editor/extensions";

const turndownService = new TurndownService();

/**
 * Converts a Tiptap JSON document to a Markdown string.
 */
export const convertTiptapToMarkdown = (doc: TiptapDoc): string => {
  if (!doc || !doc.content || doc.content.length === 0) {
    return "";
  }
  try {
    // Deep clone to avoid mutating the original object during transformation
    const mutableDoc = JSON.parse(JSON.stringify(doc)) as JSONContent;
    const html = generateHTML(mutableDoc, headlessExtensions);
    const markdown = turndownService.turndown(html);
    return markdown;
  } catch (error) {
    runClientUnscoped(
      clientLog(
        "error",
        "[convertTiptapToMarkdown] CRITICAL: Failed to convert Tiptap JSON to Markdown via HTML.",
        error,
      ),
    );
    return "--- ERROR DURING MARKDOWN CONVERSION ---";
  }
};

/**
 * Converts a Markdown string to a Tiptap JSON document.
 */
export const convertMarkdownToTiptap = (markdown: string): TiptapDoc => {
  try {
    const html = marked.parse(markdown, { async: false });
    const doc = generateJSON(html, headlessExtensions) as TiptapDoc;
    return doc;
  } catch (error) {
    runClientUnscoped(
      clientLog(
        "error",
        "[convertMarkdownToTiptap] CRITICAL: Failed to parse Markdown string via HTML.",
        error,
      ),
    );
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Error parsing Markdown." }],
        },
      ],
    };
  }
};
