// FILE: src/components/pages/note-page.ts
import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { Effect, Fiber } from "effect";
import { signal, effect } from "@preact/signals-core";
import { runClientUnscoped } from "../../lib/client/runtime";
import styles from "./NotePage.module.css";
import {
  type AppNote,
  type TiptapDoc,
  type BlockId,
  type NotebookId,
  type NoteId,
} from "../../lib/shared/schemas";
import { authState, type AuthModel } from "../../lib/client/stores/authStore";
import { notebookListState } from "../../lib/client/stores/notebookStore"; 
import { updateTabTitle } from "../../lib/client/stores/tabStore";
import { type NotePageError } from "../../lib/client/errors";
import { NoteTitleExistsError } from "../../lib/shared/errors";
import { ReplicacheService } from "../../lib/client/replicache";
import { v4 as uuidv4 } from "uuid";

// --- Components ---
import "../editor/tiptap-editor";
import "../blocks/smart-checklist";
import "../blocks/meter-input";
import "../ui/note-preview-card";
import "../ui/dropdown-menu";
import "../ui/confirm-dialog";
import "../features/history-sidebar";

import { update, handleAction, type NotePageState, type Action } from "./note-page.logic";
import {
  handleTitleKeyDown,
  handleTaskUpdate,
  handleEditorClick,
  handleLinkHover,
  handleLinkHoverEnd,
  initializeState,
  handlePageHide,
  handleInput,
  handleEditorUpdate,
  handleForceSave,
} from "./note-page.methods";
import { localeState, t } from "../../lib/client/stores/i18nStore";
import { openHistory } from "../../lib/client/stores/historyStore";
import { clientLog } from "../../lib/client/clientLog";
import type { ChecklistItem } from "../blocks/smart-checklist";

interface ChecklistFields {
  items: ChecklistItem[];
}

interface MeterFields {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
}

interface TiptapTextFields {
  content: TiptapDoc;
}

@customElement("note-page")
export class NotePage extends LitElement {
  @property({ type: String })
  override id: string = "";

  public state = signal<NotePageState>({ status: "loading" });

  private _isInitialized = false;
  private _replicacheUnsubscribe: (() => void) | undefined;
  private _authUnsubscribe: (() => void) | undefined;
  private _disposeEffect?: () => void;
  
  public _saveFiber: Fiber.RuntimeFiber<void, unknown> | undefined;

  private _handleTitleKeyDown = (e: KeyboardEvent) => handleTitleKeyDown(this, e);

  private _handleTaskUpdate = (e: Event) =>
    handleTaskUpdate(
      this,
      e as CustomEvent<{ blockId: BlockId; isComplete: boolean }>,
    );

  private _handleEditorClick = (e: MouseEvent) => handleEditorClick(this, e);
  
  private _handlePageHide = () => handlePageHide(this);
  
  private _handleInput = (updateField: Partial<AppNote>) =>
    handleInput(this, updateField);

  private _handleEditorUpdate = (e: Event) =>
    handleEditorUpdate(
      this,
      e as CustomEvent<{ content: TiptapDoc }>,
    );
  
  private _handleForceSave = (e: Event) => {
    e.stopPropagation();
    handleForceSave(this);
  };
  
  private _handleLinkHover = (e: Event) =>
    handleLinkHover(
      this,
      e as CustomEvent<{ target: string; x: number; y: number }>,
    );

  private _handleLinkHoverEnd = () => handleLinkHoverEnd(this);

  private _handleNotebookChange = (e: Event) => {
    const select = e.target as HTMLSelectElement;
    const value = select.value; 
    const notebookId = value === "inbox" ? null : (value as NotebookId);
    this._handleInput({ notebook_id: notebookId });
  };

  private _handleOpenHistory = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    if (this.state.value.status === "ready") {
        openHistory(this.state.value.note.id);
    }
  };

  private _handleBlockUpdate = (e: Event) => {
    e.stopPropagation();
    
    // ✅ FIX: Explicitly cast CustomEvent to strict type to avoid 'any' error on e.detail
    const detail = (e as CustomEvent<{ blockId: BlockId; fields: Record<string, unknown> }>).detail;
    const { blockId, fields } = detail;
    
    const currentState = this.state.peek();
    let currentVersion = 1;

    if (currentState.status === "ready") {
        const block = currentState.blocks.find(b => b.id === blockId);
        if (block) {
            currentVersion = block.version;
        }
    }

    runClientUnscoped(Effect.gen(function* () {
        const replicache = yield* ReplicacheService;
        yield* Effect.promise(() => 
            replicache.client.mutate.updateBlock({
                blockId,
                fields,
                version: currentVersion
            })
        );
    }));
  };

  private _handleAddBlock = (type: "tiptap_text" | "form_checklist" | "form_meter") => {
    const noteId = this.id as NoteId;
    const blockId = uuidv4() as BlockId;

    let initialFields = {};
    if (type === "form_checklist") {
        initialFields = { items: [{ id: uuidv4(), label: "New Item", checked: false }] };
    } else if (type === "form_meter") {
        initialFields = { label: "New Meter", value: 0, min: 0, max: 100, unit: "%" };
    }

    runClientUnscoped(Effect.gen(function* () {
        yield* clientLog("info", `[NotePage] Adding block ${type}`);
        const replicache = yield* ReplicacheService;
        yield* Effect.promise(() => 
            replicache.client.mutate.createBlock({
                noteId,
                blockId,
                type,
                fields: initialFields
            })
        );
    }));
  };

  private _initializeState = () => initializeState(this);

  public dispatch(action: Action) {
    const currentState = this.state.peek();
    const nextState = update(currentState, action);
    
    this.state.value = nextState;
    this.requestUpdate();

    if (action.type === "DATA_UPDATED") {
      updateTabTitle(action.payload.note.id, action.payload.note.title);
    }
    if (
      action.type === "UPDATE_FIELD" &&
      action.payload.title !== undefined &&
      nextState.status === "ready"
    ) {
      updateTabTitle(nextState.note.id, action.payload.title);
    }

    const effect = handleAction(action, nextState).pipe(
      Effect.catchTag("NoteTaskUpdateError", (err) =>
        Effect.sync(() =>
          this.dispatch({ type: "UPDATE_TASK_ERROR", payload: err }),
        ),
      ),
      Effect.catchTag("NoteCreationError", (err) =>
        Effect.sync(() =>
          this.dispatch({ type: "INITIALIZE_ERROR", payload: err }),
        ),
      ),
      Effect.catchTag("NoteDeletionError", (err) => 
        Effect.sync(() => 
          this.dispatch({ type: "DELETE_ERROR", payload: err })
        )
      )
    );

    runClientUnscoped(effect);
  }

  override connectedCallback() {
    super.connectedCallback();
    
    const handleAuthChange = (auth: AuthModel) => {
      if (auth.status === "authenticated" && !this._isInitialized) {
        this._isInitialized = true;
        this._initializeState();
      } else if (auth.status !== "authenticated" && this._isInitialized) {
        this._isInitialized = false;
        this._replicacheUnsubscribe?.();
        this.dispatch({ type: "INITIALIZE_START" });
      }
    };
    this._authUnsubscribe = authState.subscribe(handleAuthChange);
    handleAuthChange(authState.value);
    
    this._disposeEffect = effect(() => {
      void localeState.value;
      void notebookListState.value; 
      void this.state.value; 
      this.requestUpdate();
    });

    window.addEventListener("pagehide", this._handlePageHide);
  }

  override updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
    if (changedProperties.has("id") && this.id && this._isInitialized) {
      this._initializeState();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._replicacheUnsubscribe?.();
    this._authUnsubscribe?.();
    this._disposeEffect?.();
    window.removeEventListener("pagehide", this._handlePageHide);
    this._handlePageHide();
    if (this._saveFiber) {
      runClientUnscoped(Fiber.interrupt(this._saveFiber));
    }
  }

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const s = this.state.value;
    const notebooks = notebookListState.value;

    const getErrorMessage = (e: NotePageError | NoteTitleExistsError | null) => {
      if (!e) return null;
      switch (e._tag) {
        case "NoteNotFoundError": return t("note.not_found");
        case "NoteParseError": return "Error loading note data.";
        case "NoteSaveError": return "Failed to save changes.";
        case "NoteTitleExistsError": return "A note with this title already exists.";
        case "NoteTaskUpdateError": return "Failed to update task.";
        case "NoteCreationError": return "Failed to create note.";
        case "NoteDeletionError": return "Failed to delete note.";
      }
    };

    switch (s.status) {
      case "loading":
        return html`<div class=${styles.container}><p>${t("note.loading")}</p></div>`;

      case "error":
        return html`<div class=${styles.container}>
          <p class=${styles.errorText}>
            ${getErrorMessage(s.error) || t("note.not_found")}
          </p>
        </div>`;

      case "ready": {
        const { note, blocks, isSaving, saveError, allNoteTitles, preview, deleteConfirmOpen } = s;
        
        const renderStatus = () => {
          if (saveError) return html`<span class="text-red-500">${getErrorMessage(saveError)}</span>`;
          if (isSaving) return t("note.saving");
          return t("note.saved");
        };

        return html`
          <history-sidebar></history-sidebar>

          <div 
            class=${styles.container}
            @force-save=${this._handleForceSave}
            @update-block=${this._handleBlockUpdate} 
          >
            <div class=${styles.editor}>
              <div class=${styles.header}>
                <div class="flex flex-col gap-1">
                   <h2 class=${styles.headerH2}>${t("note.edit_title")}</h2>
                   <div class="flex items-center gap-2">
                     <span class="text-xs text-zinc-400">In:</span>
                     <select 
                       class="text-xs bg-transparent border-none text-zinc-600 font-medium focus:ring-0 cursor-pointer hover:text-zinc-900"
                       @change=${this._handleNotebookChange}
                     >
                       <option value="inbox" ?selected=${!note.notebook_id}>Inbox</option>
                       ${notebooks.map(nb => html`
                         <option value=${nb.id} ?selected=${note.notebook_id === nb.id}>
                           ${nb.name}
                         </option>
                       `)}
                     </select>
                   </div>
                </div>
                <div class="flex items-center gap-4">
                  <div class=${styles.status}>${renderStatus()}</div>
                  
                  <button
                    class="rounded-full p-1.5 text-zinc-400 shadow-sm transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                    title="View History"
                    @click=${this._handleOpenHistory}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v8"/><path d="M8 12h8"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg>
                  </button>

                  <dropdown-menu>
                    <button
                        slot="trigger"
                        class="rounded-full p-1.5 text-zinc-400 shadow-sm transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                    </button>
                    <div slot="content" class="flex flex-col min-w-[120px]">
                        <button
                            class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                            @click=${() => this.dispatch({ type: "REQUEST_DELETE" })}
                        >
                            ${t("common.delete")}
                        </button>
                    </div>
                  </dropdown-menu>
                </div>
              </div>
              
              <input
                type="text"
                data-testid="note-title-input"
                class=${styles.titleInput}
                .value=${note.title}
                @input=${(e: Event) =>
                  this._handleInput({
                    title: (e.target as HTMLInputElement).value,
                  })}
                @keydown=${this._handleTitleKeyDown}
              />

              <div class="flex flex-col gap-2 pb-12">
                ${repeat(blocks, (block) => block.id, (block) => {
                    // Use strict type checks for fields
                    switch (block.type) {
                        case 'form_checklist':
                            const checklistFields = block.fields as ChecklistFields;
                            return html`
                                <smart-checklist
                                    .blockId=${block.id}
                                    .items=${checklistFields.items || []}
                                ></smart-checklist>
                            `;
                        case 'form_meter':
                            const meterFields = block.fields as MeterFields;
                            return html`
                                <meter-input
                                    .blockId=${block.id}
                                    .label=${meterFields.label || "Meter"}
                                    .value=${meterFields.value || 0}
                                    .min=${meterFields.min || 0}
                                    .max=${meterFields.max || 100}
                                    .unit=${meterFields.unit || ""}
                                ></meter-input>
                            `;
                        case 'tiptap_text':
                        default:
                            let initialDoc = null;
                            const textFields = block.fields as TiptapTextFields;
                            
                            if (textFields && textFields.content) {
                                initialDoc = textFields.content;
                            } else {
                                const contentStr = block.content || "";
                                initialDoc = {
                                    type: "doc",
                                    content: [{
                                        type: "paragraph",
                                        content: [{ type: "text", text: contentStr }]
                                    }]
                                };
                            }
                            
                            return html`
                                <tiptap-editor
                                    .blockId=${block.id}
                                    .initialContent=${initialDoc}
                                    .allNoteTitles=${allNoteTitles}
                                    @update=${this._handleEditorUpdate} 
                                    @update-task-status=${this._handleTaskUpdate}
                                    @click=${this._handleEditorClick}
                                    @link-hover=${this._handleLinkHover}
                                    @link-hover-end=${this._handleLinkHoverEnd}
                                ></tiptap-editor>
                            `;
                    }
                })}
              </div>

              <!-- ADD BLOCK FLOATING MENU -->
              <div class="fixed bottom-6 right-6 z-50">
                <dropdown-menu>
                    <button
                        slot="trigger"
                        class="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-xl transition-transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-4 focus:ring-zinc-300"
                        title="Add Block"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    <div slot="content" class="flex min-w-[180px] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-xl">
                        <div class="px-3 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Add Block</div>
                        <button class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-zinc-700 hover:bg-zinc-50" @click=${() => this._handleAddBlock("tiptap_text")}>
                            <svg class="text-zinc-400" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>
                            <span>Text Paragraph</span>
                        </button>
                        <button class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-zinc-700 hover:bg-zinc-50" @click=${() => this._handleAddBlock("form_checklist")}>
                            <svg class="text-zinc-400" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                            <span>Checklist</span>
                        </button>
                        <button class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-zinc-700 hover:bg-zinc-50" @click=${() => this._handleAddBlock("form_meter")}>
                            <svg class="text-zinc-400" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                            <span>Meter Input</span>
                        </button>
                    </div>
                </dropdown-menu>
              </div>

            </div>

            ${preview && preview.visible
              ? html`<note-preview-card
                  .title=${preview.title}
                  .snippet=${preview.snippet || ""}
                  .x=${preview.x}
                  .y=${preview.y}
                  ?isLoading=${preview.snippet === null} 
                ></note-preview-card>`
              : nothing}

            <confirm-dialog
                .open=${deleteConfirmOpen}
                heading=${t("notes.delete_confirm_title")}
                description=${t("notes.delete_confirm_desc")}
                confirmText=${t("common.delete")}
                cancelText=${t("common.cancel")}
                @cancel=${() => this.dispatch({ type: "CANCEL_DELETE" })}
                @confirm=${() => this.dispatch({ type: "CONFIRM_DELETE" })}
            ></confirm-dialog>
          </div>
        `;
      }
    }
  }
}
