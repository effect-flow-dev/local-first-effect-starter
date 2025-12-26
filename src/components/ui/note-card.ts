// FILE: src/components/ui/note-card.ts
import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { runClientUnscoped } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";
import { t } from "../../lib/client/stores/i18nStore";
import type { AppNoteMetadata } from "../../lib/shared/schemas";
// Import styles from the parent module to ensure consistency
import styles from "../pages/NotesView.module.css";
import "../ui/dropdown-menu";

@customElement("note-card")
export class NoteCard extends LitElement {
  @property({ type: Object })
  note!: AppNoteMetadata;

  @property({ type: Boolean })
  isSelected = false;

  protected override createRenderRoot() {
    return this; // Light DOM for global styles
  }

  private _handleClick = (e: Event) => {
    // Ignore if clicked on checkbox or dropdown
    if ((e.target as HTMLElement).closest(`.${styles.checkboxContainer}`) || (e.target as HTMLElement).closest("dropdown-menu")) {
        return;
    }
    e.preventDefault();
    runClientUnscoped(navigate(`/notes/${this.note.id}`));
  };

  private _handleCheckboxChange = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent("selection-change", {
      detail: { id: this.note.id, selected: (e.target as HTMLInputElement).checked },
      bubbles: true,
      composed: true
    }));
  };

  private _handleDelete = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent("delete-request", {
      detail: { id: this.note.id },
      bubbles: true,
      composed: true
    }));
  };

  override render() {
    if (!this.note) return html``;

    return html`
      <div class="group relative">
        <!-- Checkbox -->
        <div class=${styles.checkboxContainer}>
            <input 
                type="checkbox" 
                class=${styles.checkbox}
                .checked=${this.isSelected}
                @change=${this._handleCheckboxChange}
                @click=${(e: Event) => e.stopPropagation()} 
            />
        </div>

        <a
          href="/notes/${this.note.id}"
          class=${styles.noteItem}
          @click=${this._handleClick}
        >
          <h3 class=${styles.noteItemH3}>
            ${this.note.title || t("common.untitled_note")}
          </h3>
          <p class=${styles.noteItemP}>
            ${t("notes.no_content")}
          </p>
        </a>

        <div
          class="absolute top-3 right-3 z-10"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <dropdown-menu>
            <button
              slot="trigger"
              class="rounded-full bg-white p-1.5 text-zinc-400 shadow-sm transition-colors hover:bg-zinc-100 hover:text-zinc-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
            </button>

            <div slot="content" class="flex flex-col">
              <button
                class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                @click=${this._handleDelete}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                ${t("common.delete")}
              </button>
            </div>
          </dropdown-menu>
        </div>
      </div>
    `;
  }
}
