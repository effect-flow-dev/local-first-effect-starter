// FILE: src/components/pages/notes-page.ts
import { LitElement, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { repeat } from "lit-html/directives/repeat.js";
import { Effect } from "effect";
import { signal, effect, untracked } from "@preact/signals-core";
import { runClientUnscoped } from "../../lib/client/runtime";
import { noteListState } from "../../lib/client/stores/noteListStore";
import { NotionButton } from "../ui/notion-button";
import styles from "./NotesView.module.css";
import { localeState, t } from "../../lib/client/stores/i18nStore";
import { clientLog } from "../../lib/client/clientLog";
import { navigate } from "../../lib/client/router"; // ✅ Added Import
import type { NoteId } from "../../lib/shared/schemas";

import {
  type NotesPageState,
  type Action,
  INITIAL_STATE,
  update,
} from "./notes-page.logic";
import { handleNotesPageSideEffects } from "./notes-page.effects";

import "../ui/confirm-dialog";
import "../ui/note-card";

@customElement("notes-page")
export class NotesPage extends LitElement {
  public state = signal<NotesPageState>(INITIAL_STATE);
  private _disposeEffect?: () => void;

  public dispatch(action: Action) {
    const currentState = this.state.peek();
    
    const nextState = update(currentState, action);
    this.state.value = nextState;
    this.requestUpdate();

    runClientUnscoped(
      handleNotesPageSideEffects(action, nextState, (a) => this.dispatch(a)).pipe(
        Effect.catchTag("NoteCreationError", (err) =>
          Effect.sync(() =>
            this.dispatch({ type: "CREATE_NOTE_ERROR", payload: err }),
          ),
        ),
        Effect.catchTag("NoteDeletionError", (err) =>
          Effect.sync(() =>
            this.dispatch({ type: "DELETE_NOTE_ERROR", payload: err }),
          ),
        ),
        Effect.catchAll((err) =>
          clientLog(
            "error",
            `[notes-page] Unhandled error in side effect for ${action.type}`,
            err,
          ),
        ),
      ),
    );
  }

  override connectedCallback() {
    super.connectedCallback();
    this._disposeEffect = effect(() => {
      void localeState.value; 
      const notes = noteListState.value; 
      
      untracked(() => {
        this.dispatch({ type: "NOTES_UPDATED", payload: notes });
      });
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  protected override createRenderRoot() {
    return this;
  }

  private _handleSelectionChange = (e: CustomEvent<{ id: NoteId; selected: boolean }>) => {
    this.dispatch({ type: "TOGGLE_SELECT_NOTE", payload: e.detail.id });
  };

  private _handleDeleteRequest = (e: CustomEvent<{ id: NoteId }>) => {
    this.dispatch({ type: "REQUEST_DELETE_NOTE", payload: e.detail.id });
  };

  override render() {
    const s = this.state.value;

    if (s.status === "loading") {
      return html`
        <div class=${styles.container}>
          <div class=${styles.emptyState}>
            <p>${t("notes.loading")}</p>
          </div>
        </div>
      `;
    }

    const { notes, interaction, error, selectedNoteIds } = s;
    const isCreating = interaction.type === "creating";
    
    const noteIdToDelete =
      interaction.type === "confirming_delete" || interaction.type === "deleting"
        ? interaction.noteId
        : null;
    
    const isBulkDeleteConfirm = interaction.type === "confirming_bulk_delete";
    const selectionCount = selectedNoteIds.size;
    const allSelected = notes.length > 0 && selectionCount === notes.length;

    const getErrorMessage = () => {
      if (!error) return null;
      switch (error._tag) {
        case "NoteCreationError":
          return "Could not create a new note. Please try again.";
        case "NoteDeletionError":
          return "Could not delete the note. Please try again.";
      }
    };
    const errorMessage = getErrorMessage();

    return html`
      <div class=${styles.container}>
        ${errorMessage
          ? html`<div
              class="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              <span>${errorMessage}</span>
              <button
                @click=${() => this.dispatch({ type: "CLEAR_ERROR" })}
                class="rounded-full p-1 text-red-600 transition-colors hover:bg-red-100"
                aria-label="Dismiss error"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>`
          : ""}
        
        <div class=${styles.header}>
          <div>
            <h2 class=${styles.headerH2}>${t("notes.title")}</h2>
            <p class=${styles.headerP}>${t("notes.subtitle")}</p>
          </div>
          <div class=${styles.actions}>
            ${notes.length > 0 ? html`
                <button
                    @click=${() => this.dispatch({ type: "TOGGLE_SELECT_ALL" })}
                    class="mr-2 text-sm font-medium text-zinc-500 hover:text-zinc-800 transition-colors"
                >
                    ${allSelected ? t("notes.deselect_all") : t("notes.select_all")}
                </button>
            ` : nothing}

            <!-- ✅ NEW: Table View Button -->
            <button
                @click=${() => runClientUnscoped(navigate("/notes/table"))}
                class="mr-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 transition-colors"
            >
                Table View
            </button>

            ${NotionButton({
              children: isCreating ? t("notes.creating") : t("notes.create_new"),
              onClick: () => this.dispatch({ type: "CREATE_NOTE_START" }),
              loading: isCreating,
              disabled: isCreating,
            })}
          </div>
        </div>

        <div class=${styles.notesList}>
          ${notes.length > 0
            ? repeat(
                notes,
                (note) => note.id,
                (note) => html`
                  <note-card 
                    .note=${note}
                    .isSelected=${selectedNoteIds.has(note.id)}
                    @selection-change=${this._handleSelectionChange}
                    @delete-request=${this._handleDeleteRequest}
                  ></note-card>
                `
              )
            : html`
                <div class=${styles.emptyState}>
                  <h3 class=${styles.emptyStateH3}>${t("notes.empty_title")}</h3>
                  <p class=${styles.emptyStateP}>${t("notes.empty_desc")}</p>
                </div>
              `}
        </div>

        ${selectionCount > 0 ? html`
            <div class=${styles.actionBar}>
                <span class=${styles.selectionCount}>${selectionCount} selected</span>
                
                <button 
                    class=${styles.actionButton}
                    @click=${() => this.dispatch({ type: "CANCEL_SELECTION" })}
                >
                    ${t("notes.cancel_selection")}
                </button>
                
                <button 
                    class=${styles.deleteButton}
                    @click=${() => this.dispatch({ type: "REQUEST_BULK_DELETE" })}
                >
                    ${t("notes.bulk_delete", { count: selectionCount })}
                </button>
            </div>
        ` : nothing}

        <confirm-dialog
          .open=${!!noteIdToDelete}
          heading=${t("notes.delete_confirm_title")}
          description=${t("notes.delete_confirm_desc")}
          confirmText=${t("common.delete")}
          cancelText=${t("common.cancel")}
          @cancel=${() => this.dispatch({ type: "CANCEL_DELETE_NOTE" })}
          @confirm=${() => this.dispatch({ type: "CONFIRM_DELETE_NOTE" })}
        ></confirm-dialog>

        <confirm-dialog
          .open=${isBulkDeleteConfirm}
          heading=${t("notes.bulk_delete_confirm_title", { count: selectionCount })}
          description=${t("notes.bulk_delete_confirm_desc", { count: selectionCount })}
          confirmText=${t("common.delete")}
          cancelText=${t("common.cancel")}
          @cancel=${() => this.dispatch({ type: "CANCEL_BULK_DELETE" })}
          @confirm=${() => this.dispatch({ type: "CONFIRM_BULK_DELETE" })}
        ></confirm-dialog>
      </div>
    `;
  }
}
