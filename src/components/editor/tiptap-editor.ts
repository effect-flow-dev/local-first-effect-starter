// FILE: src/components/editor/tiptap-editor.ts
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { EditorController, type EditorControllerOptions } from "./editor-controller";

// Re-export markdown transformers for consumers (legacy support during refactor)
export {
  convertTiptapToMarkdown,
  convertMarkdownToTiptap,
} from "../../lib/client/logic/markdown-transformer";

@customElement("tiptap-editor")
export class TiptapEditor extends LitElement {
  @property({ type: String })
  blockId = "";

  @property({ type: String })
  initialContent: string | object = "";

  @property({ attribute: false })
  allNoteTitles: Set<string> = new Set();

  private controller!: EditorController;

  constructor() {
    super();
    // Initialize the controller with 'this' as the host.
    // We pass 'this' as the element because createRenderRoot returns 'this' (Light DOM).
    this.controller = new EditorController(this, {
      element: this,
      initialContent: this.initialContent,
      blockId: this.blockId,
      allNoteTitles: this.allNoteTitles,
    });
  }

  public getContent() {
    return this.controller.getJSON();
  }

  public focusEditor() {
    this.controller.focus();
  }

  // We explicitly use updated() to push prop changes to the controller.
  override updated(changedProperties: PropertyValues<this>) {
    const updatePayload: Partial<EditorControllerOptions> = {};

    if (changedProperties.has("initialContent")) {
      updatePayload.initialContent = this.initialContent;
    }
    if (changedProperties.has("allNoteTitles")) {
      updatePayload.allNoteTitles = this.allNoteTitles;
    }
    if (changedProperties.has("blockId")) {
      updatePayload.blockId = this.blockId;
    }

    this.controller.updateOptions(updatePayload);
  }

  override render() {
    return html``;
  }

  protected override createRenderRoot() {
    return this;
  }
}
