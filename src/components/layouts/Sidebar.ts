// FILE: src/components/layouts/Sidebar.ts
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { effect, untracked } from "@preact/signals-core";
import { classMap } from "lit-html/directives/class-map.js";
import { repeat } from "lit-html/directives/repeat.js";
import { Effect } from "effect";
import { v4 as uuidv4 } from "uuid";

import { noteListState } from "../../lib/client/stores/noteListStore";
import { notebookListState } from "../../lib/client/stores/notebookStore";
import { sidebarState } from "../../lib/client/stores/sidebarStore";
import { tabsState } from "../../lib/client/stores/tabStore";
import { navigate } from "../../lib/client/router";
import { runClientUnscoped } from "../../lib/client/runtime";
import { ReplicacheService } from "../../lib/client/replicache";
import { authState } from "../../lib/client/stores/authStore";
import { 
  type NoteId, 
  type NotebookId, 
} from "../../lib/shared/schemas";
import styles from "./Sidebar.module.css";
// I18n
import { localeState, t } from "../../lib/client/stores/i18nStore";
import { generateUniqueTitle } from "../../lib/client/logic/title-utils";
import "../features/create-notebook-dialog";
// ✅ FIX: Import PWA store
import { installPromptState, promptInstall } from "../../lib/client/stores/pwaStore";

@customElement("side-bar")
export class Sidebar extends LitElement {
  private _disposeEffect?: () => void;
  private _currentPath = window.location.pathname;

  @state() private _selectedNotebookId: string | null = null;
  @state() private _isCreateNotebookOpen = false;
  // ✅ FIX: Add local state for install button visibility
  @state() private _canInstall = false;

  override connectedCallback() {
    super.connectedCallback();

    window.addEventListener("location-changed", this._handleLocationChange);
    window.addEventListener("popstate", this._handleLocationChange);

    this._disposeEffect = effect(() => {
      void sidebarState.value;
      void noteListState.value;
      void notebookListState.value;
      void tabsState.value;
      void localeState.value;
      // ✅ FIX: Subscribe to PWA prompt availability
      const prompt = installPromptState.value;
      
      untracked(() => {
        this._canInstall = !!prompt;
        this.requestUpdate();
      });
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
    window.removeEventListener("location-changed", this._handleLocationChange);
    window.removeEventListener("popstate", this._handleLocationChange);
  }

  private _handleLocationChange = () => {
    this._currentPath = window.location.pathname;
    this.requestUpdate();
  };

  private _handleCreateNote = (e: Event) => {
    e.stopPropagation();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    const createEffect = Effect.gen(function* () {
      const replicache = yield* ReplicacheService;
      const user = authState.value.user;
      if (!user) return;

      const newNoteId = uuidv4() as NoteId;
      const initialBlockId = uuidv4();
      
      const existingNotes = noteListState.value;
      const existingTitles = new Set(existingNotes.map((n) => n.title));
      const baseTitle = t("common.untitled_note");
      const uniqueTitle = generateUniqueTitle(baseTitle, existingTitles);

      yield* Effect.tryPromise(() =>
        replicache.client.mutate.createNote({
          id: newNoteId,
          userID: user.id,
          title: uniqueTitle,
          initialBlockId,
          notebookId: (self._selectedNotebookId as NotebookId) || undefined,
        }),
      );
      yield* navigate(`/notes/${newNoteId}`);
    });

    runClientUnscoped(createEffect);
  };

  private _handleCreateNotebook = (e: CustomEvent<{ name: string }>) => {
    const { name } = e.detail;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    const createEffect = Effect.gen(function* () {
      const replicache = yield* ReplicacheService;
      const user = authState.value.user;
      if (!user) return;

      const newId = uuidv4() as NotebookId;
      yield* Effect.tryPromise(() => 
        replicache.client.mutate.createNotebook({
          id: newId,
          name,
          userID: user.id,
        })
      );
      
      self._selectedNotebookId = newId;
      self._isCreateNotebookOpen = false;
    });

    runClientUnscoped(createEffect);
  };

  private _handleDeleteNotebook = (e: Event, id: string) => {
    e.stopPropagation();
    if(!confirm("Delete this notebook? Notes will be moved to Inbox.")) return;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    runClientUnscoped(Effect.gen(function* () {
      const replicache = yield* ReplicacheService;
      yield* Effect.tryPromise(() => 
        replicache.client.mutate.deleteNotebook({ id: id as NotebookId })
      );
      if (self._selectedNotebookId === id) {
        self._selectedNotebookId = null;
      }
    }));
  };

  private _handleNoteClick = (e: Event, noteId: string) => {
    e.preventDefault();
    runClientUnscoped(navigate(`/notes/${noteId}`));
  };

  private _selectNotebook = (id: string | null) => {
    this._selectedNotebookId = id;
  };

  // ✅ FIX: Handle Install Click
  private _handleInstallClick = (e: Event) => {
    e.preventDefault();
    void promptInstall();
  };

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const isOpen = sidebarState.value;
    const allNotes = noteListState.value;
    const notebooks = notebookListState.value;
    const openTabs = tabsState.value;

    const filteredNotes = allNotes.filter((note) => {
      if (this._selectedNotebookId === null) {
        return !note.notebook_id;
      }
      return note.notebook_id === this._selectedNotebookId;
    });

    const classes = {
      [styles.sidebar!]: true,
      [styles.open!]: isOpen,
      [styles.closed!]: !isOpen,
    };

    return html`
      <div class=${classMap(classes)}>
        <div class=${styles.content}>
          
          <!-- ✅ INBOX SECTION -->
          <div 
            class="px-4 py-2 mb-2 cursor-pointer flex items-center gap-2 hover:bg-zinc-100 ${this._selectedNotebookId === null ? 'bg-zinc-100 text-zinc-900 font-semibold' : 'text-zinc-600'}"
            @click=${() => this._selectNotebook(null)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"></path><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>
            <span class="text-sm">Inbox</span>
          </div>

          <!-- ✅ NOTEBOOKS SECTION -->
          <div class="mt-4">
            <div class="${styles.header} group">
              <span class=${styles.title}>Notebooks</span>
              <button
                class="${styles.createButton} opacity-100"
                @click=${() => this._isCreateNotebookOpen = true}
                title="Create Notebook"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
            </div>
            
            <div class="space-y-0.5">
              ${repeat(notebooks, (nb) => nb.id, (nb) => html`
                <div 
                  class="flex items-center justify-between px-4 py-1.5 cursor-pointer hover:bg-zinc-100 group ${this._selectedNotebookId === nb.id ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-600'}"
                  @click=${() => this._selectNotebook(nb.id)}
                >
                  <div class="flex items-center gap-2 overflow-hidden">
                    <svg class="shrink-0 text-zinc-400" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                    <span class="text-sm truncate">${nb.name}</span>
                  </div>
                  
                  <button 
                    class="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-200 rounded text-zinc-400 hover:text-red-500"
                    @click=${(e: Event) => this._handleDeleteNotebook(e, nb.id)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              `)}
            </div>
          </div>

          <!-- ✅ NOTES LIST HEADER (Context Aware) -->
          <div class="mt-6 mb-1 px-4 flex items-center justify-between">
             <span class="text-xs font-semibold text-zinc-400 uppercase">
               ${this._selectedNotebookId 
                 ? notebooks.find(n => n.id === this._selectedNotebookId)?.name || "Notebook" 
                 : "Inbox"}
             </span>
             <button
              class=${styles.createButton}
              @click=${this._handleCreateNote}
              title="${t("notes.create_new")}"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>

          <!-- ✅ NOTES LIST -->
          <div>
            ${filteredNotes.length === 0
              ? html`<div class="px-4 py-2 text-xs text-zinc-400 italic">
                  ${t("notes.empty_title")}
                </div>`
              : repeat(
                  filteredNotes,
                  (note) => note.id,
                  (note) => {
                    const isActive = this._currentPath === `/notes/${note.id}`;
                    const isOpenInTab = openTabs.some((t) => t.id === note.id);

                    return html`
                      <a
                        href="/notes/${note.id}"
                        class="${styles.link} ${isActive
                          ? styles.activeLink
                          : ""}"
                        @click=${(e: Event) =>
                          this._handleNoteClick(e, note.id)}
                      >
                        <div class="flex items-center justify-between">
                          <span class="truncate"
                            >${note.title || t("common.untitled_note")}</span
                          >
                          ${isOpenInTab
                            ? html`<span
                                class="ml-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 opacity-60"
                                title="Open in tabs"
                              ></span>`
                            : nothing}
                        </div>
                      </a>
                    `;
                  },
                )}
          </div>
        </div>

        <!-- ✅ FIX: Install App Button (Bottom of Sidebar) -->
        ${this._canInstall ? html`
          <div class="border-t border-zinc-200 p-4">
            <button
              class="flex w-full items-center justify-center gap-2 rounded-md bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100 transition-colors"
              @click=${this._handleInstallClick}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
              Install App
            </button>
          </div>
        ` : nothing}

        <create-notebook-dialog
          .open=${this._isCreateNotebookOpen}
          @close=${() => this._isCreateNotebookOpen = false}
          @create=${this._handleCreateNotebook}
        ></create-notebook-dialog>
      </div>
    `;
  }
}
