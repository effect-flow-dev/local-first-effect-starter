// FILE: src/components/features/create-notebook-dialog.ts
import { LitElement, html } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { NotionButton } from "../ui/notion-button";
import { NotionInput } from "../ui/notion-input";
import { t } from "../../lib/client/stores/i18nStore";

@customElement("create-notebook-dialog")
export class CreateNotebookDialog extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) loading = false;

  @state() private name = "";

  @query("dialog") private _dialog!: HTMLDialogElement;

  override updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("open")) {
      if (this.open) {
        this._dialog.showModal();
      } else {
        this._dialog.close();
        // Reset state on close
        this.name = "";
      }
    }
  }

  private _handleClose = () => {
    this.dispatchEvent(new CustomEvent("close"));
  };

  private _handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!this.name.trim()) return;

    this.dispatchEvent(
      new CustomEvent("create", {
        detail: { name: this.name.trim() },
      })
    );
  };

  // Standard light DOM styles for dialog
  protected override createRenderRoot() {
    return this;
  }

  override render() {
    return html`
      <dialog
        class="backdrop:bg-zinc-900/20 backdrop:backdrop-blur-sm open:animate-in open:fade-in-0 open:zoom-in-95 m-auto w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-xl outline-none"
        @close=${this._handleClose}
      >
        <h3 class="mb-4 text-lg font-semibold text-zinc-900">
          New Notebook
        </h3>
        
        <form @submit=${this._handleSubmit} class="flex flex-col gap-4">
          ${NotionInput({
            id: "notebook-name",
            label: "Name",
            value: this.name,
            placeholder: "e.g. Work, Project X",
            required: true,
            onInput: (e) => (this.name = (e.target as HTMLInputElement).value),
          })}

          <div class="mt-2 flex justify-end gap-3">
            <button
              type="button"
              @click=${this._handleClose}
              class="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            >
              ${t("common.cancel")}
            </button>
            ${NotionButton({
              children: this.loading ? "Creating..." : "Create",
              type: "submit",
              loading: this.loading,
              disabled: !this.name.trim() || this.loading,
            })}
          </div>
        </form>
      </dialog>
    `;
  }
}
