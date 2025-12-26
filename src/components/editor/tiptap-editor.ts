// src/components/editor/tiptap-editor.ts
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { generateHTML, generateJSON } from "@tiptap/html";
import TurndownService from "turndown";
import { marked } from "marked";
import type { TiptapDoc } from "../../lib/shared/schemas";
// Removed MovableNodes and FocusBlock (handled by parent list now)
import { InteractiveNode } from "./extensions/InteractiveNode";
import { TagMark } from "./extensions/TagMark";
import { LinkMark } from "./extensions/LinkMark";
import { MetadataMark } from "./extensions/MetadataMark";
import {
  BrokenLinkHighlighter,
  brokenLinkPluginKey,
} from "./extensions/BrokenLinkHighlighter";
import { StableId } from "./extensions/StableId";
import { NotionParagraph, NotionHeading } from "./extensions/NotionBlock";
import { AlertBlock } from "./extensions/AlertBlock";
import { clientLog } from "../../lib/client/clientLog";
import { runClientUnscoped } from "../../lib/client/runtime";

/**
 * Performs a deep comparison between two values to determine if they are equivalent.
 */
// ✅ FIX: Use unknown instead of any to prevent unsafe access
function deepEqual(a: unknown, b: unknown, path = ""): boolean {
  if (a === b) return true;
  
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }

  if (typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], `${path}[${i}]`)) return false;
    }
    return true;
  }

  if (Array.isArray(b)) return false; // a is object, b is array

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) {
      return false;
  }

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
     
    if (!deepEqual(objA[key], objB[key], `${path}.${key}`)) return false;
  }

  return true;
}

@customElement("tiptap-editor")
export class TiptapEditor extends LitElement {
  @property({ type: String })
  blockId = "";

  @property({ type: String })
  initialContent: string | object = "";

  @property({ attribute: false })
  allNoteTitles: Set<string> = new Set();

  private editor?: Editor;
  private isInternallyUpdating = false;
  private _debounceTimer?: ReturnType<typeof setTimeout>;

  public getContent() {
    return this.editor?.getJSON();
  }

  public focusEditor() {
    this.editor?.chain().focus().run();
  }

  override firstUpdated() {
    this.editor = new Editor({
      element: this,
      extensions: [
        StarterKit.configure({
          hardBreak: false,
          paragraph: false,
          heading: false,
        }),
        NotionParagraph,
        NotionHeading,
        InteractiveNode,
        AlertBlock,
        TagMark,
        LinkMark,
        MetadataMark,
        StableId,
        BrokenLinkHighlighter.configure({ allNoteTitles: this.allNoteTitles }),
      ],

      content: this._parseInitialContent(),
      editorProps: {
        attributes: {
          class: "prose prose-zinc focus:outline-none max-w-full pl-4", 
        },
      },
      onUpdate: ({ editor }) => {
        this.isInternallyUpdating = true;
        
        // Reset the internal update flag shortly after
        setTimeout(() => {
          this.isInternallyUpdating = false;
        }, 0);

        const content = editor.getJSON();

        if (this.blockId) {
            if (this._debounceTimer) clearTimeout(this._debounceTimer);

            this._debounceTimer = setTimeout(() => {
                runClientUnscoped(clientLog("debug", `[TiptapEditor] Emitting debounced block update for ${this.blockId}`));
                this.dispatchEvent(
                    new CustomEvent("update-block", {
                        bubbles: true,
                        composed: true,
                        detail: {
                            blockId: this.blockId,
                            fields: { content } 
                        }
                    })
                );
            }, 500); // 500ms Debounce
        } else {
            this.dispatchEvent(
              new CustomEvent("update", {
                detail: {
                  content,
                },
              }),
            );
        }
      },
    });
  }

  private _parseInitialContent(): JSONContent {
    if (!this.initialContent) {
        return {
            type: "doc",
            content: [{ type: "paragraph", content: [] }],
        };
    }

    if (typeof this.initialContent === "object") {
        return this.initialContent as JSONContent;
    }

    const str = this.initialContent.trim();
    
    try {
        if (str.startsWith("{")) {
            return JSON.parse(str) as JSONContent;
        }
    } catch {
        // Not JSON
    }

    return {
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{ type: "text", text: str }],
            },
        ],
    };
  }

  override updated(changedProperties: PropertyValues<this>) {
    if (changedProperties.has("initialContent") && this.editor) {
      if (this.isInternallyUpdating) {
        return;
      }

      const newContent = this._parseInitialContent();
      const currentContent = this.editor.getJSON();

      if (!deepEqual(currentContent, newContent)) {
        const { from, to } = this.editor.state.selection;
        this.editor.commands.setContent(newContent, {
          emitUpdate: false,
        });
        this.editor.commands.setTextSelection({ from, to });
      }
    }

    if (changedProperties.has("allNoteTitles") && this.editor) {
      const tr: Transaction = this.editor.state.tr.setMeta(
        brokenLinkPluginKey,
        this.allNoteTitles,
      );
      this.editor.view.dispatch(tr);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.editor?.destroy();
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
  }

  override render() {
    return html``;
  }

  protected override createRenderRoot() {
    return this;
  }
}

// ... Markdown helpers (Unchanged) ...
const turndownService = new TurndownService();
const extensions = [
  StarterKit.configure({
    hardBreak: false,
    paragraph: false,
    heading: false,
  }),
  NotionParagraph,
  NotionHeading,
  InteractiveNode,
  AlertBlock,
  TagMark,
  LinkMark,
  MetadataMark,
  StableId,
];
export const convertTiptapToMarkdown = (doc: TiptapDoc): string => {
  if (!doc || !doc.content || doc.content.length === 0) {
    return "";
  }
  try {
    const mutableDoc = JSON.parse(JSON.stringify(doc)) as JSONContent;
    const html = generateHTML(mutableDoc, extensions);
    const markdown = turndownService.turndown(html);
    return markdown;
  } catch (error) {
    runClientUnscoped(clientLog(
      "error",
      "[convertTiptapToMarkdown] CRITICAL: Failed to convert Tiptap JSON to Markdown via HTML.",
      error,
    ));
    return "--- ERROR DURING MARKDOWN CONVERSION ---";
  }
};

export const convertMarkdownToTiptap = (markdown: string): TiptapDoc => {
  try {
    const html = marked.parse(markdown, { async: false });
    const doc = generateJSON(html, extensions) as TiptapDoc;
    return doc;
  } catch (error) {
    runClientUnscoped(clientLog(
      "error",
      "[convertMarkdownToTiptap] CRITICAL: Failed to parse Markdown string via HTML.",
      error,
    ));
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
