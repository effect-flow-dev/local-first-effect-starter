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
    type AppBlock,
} from "../../lib/shared/schemas";
import { authState, type AuthModel } from "../../lib/client/stores/authStore";
import { notebookListState } from "../../lib/client/stores/notebookStore";
import { updateTabTitle } from "../../lib/client/stores/tabStore";
import { type NotePageError } from "../../lib/client/errors";
import { NoteTitleExistsError } from "../../lib/shared/errors";
import { ReplicacheService } from "../../lib/client/replicache";
import { HlcService } from "../../lib/client/hlc/HlcService"; 
import { v4 as uuidv4 } from "uuid";
import { getCurrentPosition } from "../../lib/client/geolocation";

import { savePendingMedia, prewarmMemoryCache } from "../../lib/client/media/mediaStore";
import { MediaSyncService } from "../../lib/client/media/MediaSyncService";

import { sendFocus } from "../../lib/client/replicache/websocket";
import { presenceState } from "../../lib/client/stores/presenceStore";
import "../ui/presence-indicator";

import "../editor/tiptap-editor";
import "../blocks/smart-checklist";
import "../blocks/meter-input";
import "../blocks/map-block";
import "../editor/node-views/file-attachment-node-view"; 
import "../editor/node-views/image-block-node-view";     
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
    handleBlockUpdateMethod, 
} from "./note-page.methods";
import { localeState, t } from "../../lib/client/stores/i18nStore";
import { openHistory } from "../../lib/client/stores/historyStore";
import type { ChecklistItem } from "../blocks/smart-checklist";
import { clientLog } from "../../lib/client/clientLog";

interface ChecklistFields { items: ChecklistItem[]; }
interface MeterFields { 
    label: string; 
    value: number; 
    min: number; 
    max: number; 
    unit: string;
    validation_status?: string; 
}
interface MapFields { zoom?: number; style?: string; }
interface FileFields { 
    url?: string; 
    uploadId?: string; 
    filename: string; 
    size: number; 
    mimeType: string; 
}
interface ImageFields {
    url?: string;
    uploadId?: string;
    caption?: string;
}

interface UpdateTaskStatusEventDetail { blockId: BlockId; isComplete: boolean; version: number; }
interface EditorUpdateEventDetail { content: TiptapDoc; }
interface LinkHoverEventDetail { target: string; x: number; y: number; }

@customElement("note-page")
export class NotePage extends LitElement {
    @property({ type: String })
    override id: string = "";

    public state = signal<NotePageState>({ status: "loading" });

    private _isInitialized = false;
    private _replicacheUnsubscribe: (() => void) | undefined;
    private _authUnsubscribe: (() => void) | undefined;
    private _disposeEffect?: () => void;
    private _focusDebounceTimer?: ReturnType<typeof setTimeout>;

    public _saveFiber: Fiber.RuntimeFiber<void, unknown> | undefined;

    private _handleTitleKeyDown = (e: KeyboardEvent) => handleTitleKeyDown(this, e);

    private _handleTaskUpdate = (e: CustomEvent<UpdateTaskStatusEventDetail>) =>
        handleTaskUpdate(this, e);

    private _handleEditorClick = (e: MouseEvent) => handleEditorClick(this, e);

    private _handlePageHide = () => handlePageHide(this);

    private _handleInput = (updateField: Partial<AppNote>) =>
        handleInput(this, updateField);

    private _handleEditorUpdate = (e: CustomEvent<EditorUpdateEventDetail>) =>
        handleEditorUpdate(this, e);

    private _handleForceSave = (e: Event) => {
        e.stopPropagation();
        runClientUnscoped(clientLog("info", "[note-page] Received force-save event."));
        handleForceSave(this);
    };

    private _handleLinkHover = (e: CustomEvent<LinkHoverEventDetail>) =>
        handleLinkHover(this, e);

    private _handleLinkHoverEnd = () => handleLinkHoverEnd(this);
    
    private _handleNotebookChange = (e: Event) => {
        const select = e.target as HTMLSelectElement;
        const value = select.value;
        const notebookId = value === "inbox" ? null : (value as NotebookId);
        this._handleInput({ notebook_id: notebookId });
    };

    private _handleOpenHistory = (e: Event) => {
        e.preventDefault(); e.stopPropagation();
        if (this.state.value.status === "ready") openHistory(this.state.value.note.id);
    };

    private _handleBlockUpdate = (e: Event) => {
        e.stopPropagation();

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

        handleBlockUpdateMethod(this, blockId, fields, currentVersion);
    };

    private _handleIncrementBlock = (e: Event) => {
        e.stopPropagation();
        const detail = (e as CustomEvent<{ blockId: BlockId; key: string; delta: number }>).detail;
        const { blockId, key, delta } = detail;

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
            const hlc = yield* HlcService;
            
            const hlcTimestamp = yield* hlc.getNextHlc();
            const deviceTimestamp = new Date();

            yield* Effect.promise(() => replicache.client.mutate.incrementCounter({
                blockId,
                key,
                delta,
                version: currentVersion,
                hlcTimestamp,
                deviceTimestamp
            }));
        }));
    };

    // ✅ NEW: Handle Block Deletion
    private _handleBlockDelete = (e: Event) => {
        e.stopPropagation();
        
        runClientUnscoped(clientLog("info", "[NotePage] _handleBlockDelete called", e));

        // Find the wrapper element to get the block ID
        const target = e.target as HTMLElement;
        const wrapper = target.closest('[data-block-id]');
        
        if (wrapper) {
            const blockId = wrapper.getAttribute('data-block-id') as BlockId;
            runClientUnscoped(clientLog("debug", `[NotePage] Found block wrapper: ${blockId}`));
            
            if (blockId) {
                runClientUnscoped(Effect.gen(function* () {
                     const replicache = yield* ReplicacheService;
                     const hlc = yield* HlcService;
                     const hlcTimestamp = yield* hlc.getNextHlc();
                     const deviceTimestamp = new Date();
                     
                     yield* clientLog("info", `[NotePage] Executing mutate.deleteBlock for ${blockId}`);

                     yield* Effect.promise(() => replicache.client.mutate.deleteBlock({
                         blockId,
                         hlcTimestamp,
                         deviceTimestamp
                     }));
                }));
            }
        } else {
             runClientUnscoped(clientLog("warn", "[NotePage] _handleBlockDelete: Wrapper with data-block-id not found", target));
        }
    };

    private _handleFileSelect = (e: Event) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        input.value = "";

        const noteId = this.id as NoteId;
        const blockId = uuidv4() as BlockId;
        const uploadId = uuidv4();
        
        const blobUrl = URL.createObjectURL(file);
        prewarmMemoryCache(uploadId, blobUrl);

        runClientUnscoped(Effect.gen(function* () {
            yield* clientLog("info", "[NotePage] Manual file upload started", { uploadId, type: file.type });
            yield* savePendingMedia(uploadId, blockId, file);
            const service = yield* MediaSyncService;
            yield* service.queueUpload(uploadId);

            const replicache = yield* ReplicacheService;
            const hlc = yield* HlcService;
            const location = yield* getCurrentPosition();

            const hlcTimestamp = yield* hlc.getNextHlc();
            const deviceTimestamp = new Date();

            if (file.type.startsWith("image/")) {
                yield* Effect.promise(() =>
                    replicache.client.mutate.createBlock({
                        noteId,
                        blockId,
                        type: "image",
                        fields: { uploadId },
                        latitude: location?.latitude,
                        longitude: location?.longitude,
                        hlcTimestamp,
                        deviceTimestamp
                    })
                );
            } else {
                yield* Effect.promise(() =>
                    replicache.client.mutate.createBlock({
                        noteId,
                        blockId,
                        type: "file_attachment",
                        fields: {
                            uploadId,
                            filename: file.name,
                            size: file.size,
                            mimeType: file.type || "application/octet-stream"
                        },
                        latitude: location?.latitude,
                        longitude: location?.longitude,
                        hlcTimestamp,
                        deviceTimestamp
                    })
                );
            }
        }));
    };

    private _handleAddBlock = (type: "tiptap_text" | "form_checklist" | "form_meter" | "map_block") => {
        const noteId = this.id as NoteId;
        const blockId = uuidv4() as BlockId;

        runClientUnscoped(Effect.gen(function* () {
            yield* clientLog("info", `[NotePage] Adding block of type ${type}...`);
            
            const location = yield* getCurrentPosition();
            const replicache = yield* ReplicacheService;
            const hlc = yield* HlcService;

            const hlcTimestamp = yield* hlc.getNextHlc();
            const deviceTimestamp = new Date();

            const latitude = location?.latitude;
            const longitude = location?.longitude;

            switch (type) {
                case "form_checklist":
                    yield* Effect.promise(() =>
                        replicache.client.mutate.createBlock({
                            noteId,
                            blockId,
                            type: "form_checklist",
                            fields: { items: [{ id: uuidv4(), label: "New Item", checked: false }] },
                            latitude,
                            longitude,
                            hlcTimestamp,
                            deviceTimestamp
                        })
                    );
                    break;
                case "form_meter":
                    yield* Effect.promise(() =>
                        replicache.client.mutate.createBlock({
                            noteId,
                            blockId,
                            type: "form_meter",
                            fields: { label: "New Meter", value: 0, min: 0, max: 100, unit: "%" },
                            latitude,
                            longitude,
                            hlcTimestamp,
                            deviceTimestamp
                        })
                    );
                    break;
                case "map_block":
                    yield* Effect.promise(() =>
                        replicache.client.mutate.createBlock({
                            noteId,
                            blockId,
                            type: "map_block",
                            fields: { zoom: 13 },
                            latitude,
                            longitude,
                            hlcTimestamp,
                            deviceTimestamp
                        })
                    );
                    break;
                case "tiptap_text":
                    yield* Effect.promise(() =>
                        replicache.client.mutate.createBlock({
                            noteId,
                            blockId,
                            type: "tiptap_text",
                            content: "",
                            fields: {},
                            latitude,
                            longitude,
                            hlcTimestamp,
                            deviceTimestamp
                        })
                    );
                    break;
            }
        }));
    };

    private _initializeState = () => initializeState(this);

    private _handleBlockFocusIn = (e: FocusEvent) => {
        const target = e.target as HTMLElement;
        const wrapper = target.closest('[data-block-id]');
        if (wrapper) {
            const blockId = wrapper.getAttribute('data-block-id');
            if (blockId) {
                this._broadcastFocus(blockId);
            }
        }
    };

    private _broadcastFocus(blockId: string) {
        if (this._focusDebounceTimer) {
            clearTimeout(this._focusDebounceTimer);
        }
        this._focusDebounceTimer = setTimeout(() => {
            sendFocus(blockId);
        }, 200);
    }

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
            void presenceState.value; 
            this.requestUpdate();
        });

        window.addEventListener("pagehide", this._handlePageHide);
    }

    override updated(changed: Map<string, unknown>) { super.updated(changed); if(changed.has("id") && this.id && this._isInitialized) this._initializeState(); }
    override disconnectedCallback() { 
        super.disconnectedCallback(); 
        this._replicacheUnsubscribe?.(); 
        this._authUnsubscribe?.(); 
        this._disposeEffect?.(); 
        window.removeEventListener("pagehide", this._handlePageHide);
        if (this._saveFiber) runClientUnscoped(Fiber.interrupt(this._saveFiber));
    }

    protected override createRenderRoot() {
        return this;
    }

    private _renderBlock(block: AppBlock) {
        if (block.type === 'alert') {
            return html`
                <div class="alert-block p-4 my-4 rounded-md bg-red-50 border-l-4 border-red-500 text-red-800 flex items-center justify-between" data-block-id="${block.id}">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span class="text-sm font-medium">${block.content}</span>
                    </div>
                    <button 
                        class="px-3 py-1.5 bg-white border border-red-200 text-red-700 text-xs font-semibold rounded hover:bg-red-50 transition-colors"
                        @click=${this._handleOpenHistory}
                    >
                        View Version History
                    </button>
                </div>
            `;
        }

        const presence = presenceState.value[block.id] || [];
        const currentUserId = authState.value.user?.id;
        const activeRemoteUser = presence.find(u => u.userId !== currentUserId);
        
        const borderStyle = activeRemoteUser 
            ? `border-left: 3px solid ${activeRemoteUser.color}; padding-left: 8px; transition: border-left 0.2s ease;`
            : `border-left: 3px solid transparent; padding-left: 8px; transition: border-left 0.2s ease;`;

        let content = html``;

        switch (block.type) {
            case 'form_checklist': {
                const fields = block.fields as ChecklistFields;
                content = html`
                    <smart-checklist
                        .blockId=${block.id}
                        .items=${fields.items || []}
                    ></smart-checklist>`;
                break;
            }
            case 'form_meter': {
                const fields = block.fields as MeterFields;
                content = html`
                    <meter-input
                        .blockId=${block.id}
                        .label=${fields.label || "Meter"}
                        .value=${fields.value || 0}
                        .min=${fields.min || 0}
                        .max=${fields.max || 100}
                        .unit=${fields.unit || ""}
                        .validationStatus=${fields.validation_status || ""}
                    ></meter-input>`;
                break;
            }
            case 'map_block': {
                const fields = block.fields as MapFields;
                content = html`
                    <map-block
                        .blockId=${block.id}
                        .latitude=${block.latitude ?? 51.505}
                        .longitude=${block.longitude ?? -0.09}
                        .zoom=${fields.zoom ?? 13}
                    ></map-block>`;
                break;
            }
            // ✅ NEW: Handle File Attachment Block
            case 'file_attachment': {
                const fields = block.fields as FileFields;
                content = html`
                    <file-attachment-node-view
                        .filename=${fields.filename}
                        .size=${fields.size}
                        .mimeType=${fields.mimeType}
                        .url=${fields.url || ""}
                        .uploadId=${fields.uploadId || ""}
                    ></file-attachment-node-view>
                `;
                break;
            }
            // ✅ NEW: Handle Image Block
            case 'image': {
                const fields = block.fields as ImageFields;
                content = html`
                    <image-block-node-view
                        .url=${fields.url || ""}
                        .uploadId=${fields.uploadId || ""}
                    ></image-block-node-view>
                `;
                break;
            }
            case 'tiptap_text':
            default: {
                let initialDoc: object | null = null;
                
                if (block.content && block.content.trim().startsWith('{')) {
                    try {
                        initialDoc = JSON.parse(block.content) as object;
                    } catch {
                        initialDoc = null;
                    }
                }

                if (!initialDoc) {
                    // ✅ FIX: Construct valid initial doc.
                    // If content is empty string, create an EMPTY array for paragraph content.
                    // ProseMirror/Tiptap throws RangeError if you pass { text: "" }.
                    const paragraphContent = block.content ? [{ type: "text", text: block.content }] : [];
                    
                    initialDoc = { 
                        type: "doc", 
                        content: [{ 
                            type: "paragraph",
                            // ✅ FIX: Inject blockId into attributes for StableId to prevent "Generated new ID" logs
                            attrs: { blockId: block.id, version: block.version },
                            content: paragraphContent 
                        }] 
                    };
                }

                content = html`
                    <tiptap-editor
                        .blockId=${block.id}
                        .initialContent=${initialDoc}
                        @update=${this._handleEditorUpdate}
                        @update-task-status=${this._handleTaskUpdate}
                        @click=${this._handleEditorClick}
                        @link-hover=${this._handleLinkHover}
                        @link-hover-end=${this._handleLinkHoverEnd}
                        @view-history-request=${this._handleOpenHistory} 
                    ></tiptap-editor>`;
                break;
            }
        }

        return html`
            <div 
                class="group relative" 
                data-block-id="${block.id}"
                style="${borderStyle}"
            >
                <div class="absolute -top-3 right-0 z-10">
                    <presence-indicator .blockId=${block.id}></presence-indicator>
                </div>
                ${content}
                
                <!-- ✅ ADDED: Delete Button visible on hover -->
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                     <button
                        class="p-1 rounded bg-white border border-zinc-200 text-zinc-400 hover:text-red-500 hover:border-red-200 shadow-sm"
                        @click=${this._handleBlockDelete}
                        title="Delete Block"
                     >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                     </button>
                </div>
            </div>
        `;
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
                const { note, blocks, saveError, deleteConfirmOpen, preview } = s;

                return html`
                  <history-sidebar></history-sidebar>
                  
                  <input 
                    type="file" 
                    id="hidden-file-input" 
                    class="hidden" 
                    @change=${this._handleFileSelect} 
                  />

                  <div
                    class=${styles.container}
                    @force-save=${this._handleForceSave}
                    @update-block=${this._handleBlockUpdate}
                    @increment-block=${this._handleIncrementBlock}
                    @focusin=${this._handleBlockFocusIn}
                    @delete-block=${this._handleBlockDelete} 
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
                          ${saveError ? html`<span class="text-red-500">${getErrorMessage(saveError)}</span>` : nothing}

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

                      <div class="flex flex-col gap-4 pb-12">
                        ${repeat(blocks, (block) => block.id, (block) => this._renderBlock(block))}
                      </div>

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
                                <button class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-zinc-700 hover:bg-zinc-50" @click=${() => this._handleAddBlock("map_block")}>
                                    <svg class="text-zinc-400" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>
                                    <span>Map</span>
                                </button>
                                <!-- ✅ NEW: Upload Button -->
                                <button class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-zinc-700 hover:bg-zinc-50" @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#hidden-file-input")?.click()}>
                                    <svg class="text-zinc-400" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                    <span>Upload File</span>
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
