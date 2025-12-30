// FILE: src/components/editor/editor-controller.ts
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { deepEqual } from "../../lib/client/logic/deep-equal";
import { clientLog } from "../../lib/client/clientLog";
import { runClientUnscoped } from "../../lib/client/runtime";
import { getExtensions, brokenLinkPluginKey } from "./extensions";

export interface EditorControllerOptions {
  /**
   * The host element (Lit component) that this controller is attached to.
   * Used for dispatching events and mounting the editor.
   */
  element: HTMLElement;
  /**
   * Initial content for the editor. Can be a JSON object or string.
   */
  initialContent: string | object;
  /**
   * The Block ID if this editor represents a specific block (for granular updates).
   */
  blockId?: string;
  /**
   * Set of known note titles for wikilink validation.
   */
  allNoteTitles?: Set<string>;
}

export class EditorController implements ReactiveController {
  public editor?: Editor;
  private isInternallyUpdating = false;
  private _debounceTimer?: ReturnType<typeof setTimeout>;
  
  private host: ReactiveControllerHost;
  private options: EditorControllerOptions;

  constructor(host: ReactiveControllerHost, options: EditorControllerOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  hostConnected() {
    this.initEditor();
  }

  hostDisconnected() {
    this.editor?.destroy();
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
  }

  hostUpdated() {
    // This is called after the host's update cycle.
  }

  /**
   * Updates the editor options and synchronizes state if needed.
   * Should be called by the host component's `updated` or `willUpdate` method.
   */
  updateOptions(newOptions: Partial<EditorControllerOptions>) {
    // Sync Note Titles (for BrokenLinkHighlighter)
    if (
      newOptions.allNoteTitles &&
      this.editor &&
      this.options.allNoteTitles !== newOptions.allNoteTitles
    ) {
      const tr: Transaction = this.editor.state.tr.setMeta(
        brokenLinkPluginKey,
        newOptions.allNoteTitles,
      );
      this.editor.view.dispatch(tr);
    }

    // Sync Content
    if (
      newOptions.initialContent !== undefined &&
      this.editor &&
      !this.isInternallyUpdating
    ) {
      const newParsed = this._parseContent(newOptions.initialContent);
      const currentContent = this.editor.getJSON();

      if (!deepEqual(currentContent, newParsed)) {
        const { from, to } = this.editor.state.selection;
        this.editor.commands.setContent(newParsed, {
          emitUpdate: false,
        });
        this.editor.commands.setTextSelection({ from, to });
      }
    }

    // Merge options
    this.options = { ...this.options, ...newOptions };
  }

  private initEditor() {
    if (this.editor) return;

    this.editor = new Editor({
      element: this.options.element,
      extensions: getExtensions({
        allNoteTitles: this.options.allNoteTitles,
      }),
      content: this._parseContent(this.options.initialContent),
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

        if (this.options.blockId) {
          if (this._debounceTimer) clearTimeout(this._debounceTimer);

          this._debounceTimer = setTimeout(() => {
            runClientUnscoped(
              clientLog(
                "debug",
                `[TiptapEditor] Emitting debounced block update for ${this.options.blockId}`,
              ),
            );
            this.options.element.dispatchEvent(
              new CustomEvent("update-block", {
                bubbles: true,
                composed: true,
                detail: {
                  blockId: this.options.blockId,
                  fields: { content },
                },
              }),
            );
          }, 500); // 500ms Debounce
        } else {
          this.options.element.dispatchEvent(
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

  private _parseContent(content: string | object): JSONContent {
    if (!content) {
      return {
        type: "doc",
        content: [{ type: "paragraph", content: [] }],
      };
    }

    if (typeof content === "object") {
      return content as JSONContent;
    }

    const str = content.trim();

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

  public focus() {
    this.editor?.chain().focus().run();
  }

  public getJSON() {
    return this.editor?.getJSON();
  }
}
