// FILE: src/components/editor/editor-controller.ts
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { deepEqual } from "../../lib/client/logic/deep-equal";
import { clientLog } from "../../lib/client/clientLog";
import { runClientUnscoped } from "../../lib/client/runtime";
import { getExtensions, brokenLinkPluginKey } from "./extensions";
import { incrementDirtyEditors, decrementDirtyEditors } from "../../lib/client/stores/syncStore";

export interface EditorControllerOptions {
  element: HTMLElement;
  initialContent: string | object;
  blockId?: string;
  allNoteTitles?: Set<string>;
}

export class EditorController implements ReactiveController {
  public editor?: Editor;
  private isInternallyUpdating = false;
  private isDirty = false;
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
    // ✅ FIX: Flush pending changes on disconnect to survive page reloads
    if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._emitUpdate();
        if (this.isDirty) {
            this.isDirty = false;
            decrementDirtyEditors();
        }
    }
    this.editor?.destroy();
  }

  updateOptions(newOptions: Partial<EditorControllerOptions>) {
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

    // ✅ FIX: Reject prop updates while local state is dirty (typing/debouncing)
    // This prevents incoming syncs from reverting the cursor while the user is mid-sentence.
    if (
      newOptions.initialContent !== undefined &&
      this.editor &&
      !this.isInternallyUpdating &&
      !this.isDirty
    ) {
      const newParsed = this._parseContent(newOptions.initialContent);
      const currentContent = this.editor.getJSON();

      if (!deepEqual(currentContent, newParsed)) {
        const { from, to } = this.editor.state.selection;
        this.editor.commands.setContent(newParsed, { emitUpdate: false });
        // Restore cursor
        if (this.editor.isFocused) {
            this.editor.commands.setTextSelection({ from, to });
        }
      }
    }

    this.options = { ...this.options, ...newOptions };
  }

  private _emitUpdate() {
    if (!this.editor || !this.options.blockId) return;

    const content = this.editor.getJSON();
    runClientUnscoped(
        clientLog("debug", `[TiptapEditor] Dispatching block update for ${this.options.blockId}`)
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
        setTimeout(() => { this.isInternallyUpdating = false; }, 0);

        if (this.options.blockId) {
          if (this._debounceTimer) clearTimeout(this._debounceTimer);

          // ✅ Track dirty state for sync indicator
          if (!this.isDirty) {
              this.isDirty = true;
              incrementDirtyEditors();
          }

          this._debounceTimer = setTimeout(() => {
            this._emitUpdate();
            this.isDirty = false;
            this._debounceTimer = undefined;
            decrementDirtyEditors();
          }, 500); 
        } else {
          this.options.element.dispatchEvent(
            new CustomEvent("update", {
              detail: { content: editor.getJSON() },
            }),
          );
        }
      },
    });
  }

  private _parseContent(content: string | object): JSONContent {
    if (!content) {
      return { type: "doc", content: [{ type: "paragraph", content: [] }] };
    }
    if (typeof content === "object") {
      return content as JSONContent;
    }
    try {
      if (content.trim().startsWith("{")) {
        return JSON.parse(content) as JSONContent;
      }
    } catch {}
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: content }] }],
    };
  }

  public focus() { this.editor?.chain().focus().run(); }
  public getJSON() { return this.editor?.getJSON(); }
}
