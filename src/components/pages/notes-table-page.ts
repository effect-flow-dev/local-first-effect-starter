// FILE: src/components/pages/notes-table-page.ts
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { Effect } from "effect";
import { TableController } from "../../lib/client/controllers/table-controller";
import { noteListState } from "../../lib/client/stores/noteListStore";
import { t } from "../../lib/client/stores/i18nStore";
import { runClientUnscoped } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";
import { ReplicacheService } from "../../lib/client/replicache";
import type { AppNoteMetadata, NoteId } from "../../lib/shared/schemas";

import "../ui/table/table-search";
import "../ui/table/table-header";
import "../ui/table/table-pagination";
// import "../ui/table/table-row-action"; // <-- Removed wrapper
import "../ui/dropdown-menu"; // <-- Use direct primitive
import "../ui/confirm-dialog";

@customElement("notes-table-page")
export class NotesTablePage extends LitElement {
  private tableCtrl = new TableController<AppNoteMetadata>(this, {
    source: noteListState,
    searchableFields: ["title"],
    initialPageSize: 10,
  });

  private _deleteId: string | null = null;

  protected override createRenderRoot() {
    return this;
  }

  private _handleSort = (e: CustomEvent<string>) => {
    this.tableCtrl.handleSort(e.detail as keyof AppNoteMetadata);
  };

  private _handleSearch = (e: CustomEvent<string>) => {
    this.tableCtrl.setSearch(e.detail);
  };

  private _handlePageChange = (e: CustomEvent<number>) => {
    this.tableCtrl.setPage(e.detail);
  };

  private _navigateToNote = (id: string) => {
    runClientUnscoped(navigate(`/notes/${id}`));
  };

  private _confirmDelete = (id: string) => {
    this._deleteId = id;
    this.requestUpdate();
  };

  private _cancelDelete = () => {
    this._deleteId = null;
    this.requestUpdate();
  };

  private _executeDelete = () => {
    if (!this._deleteId) return;
    const id = this._deleteId;
    
    runClientUnscoped(
      Effect.gen(function* () {
        const replicache = yield* ReplicacheService;
        yield* Effect.promise(() =>
          replicache.client.mutate.deleteNote({ id: id as NoteId })
        );
      })
    );
    
    this._deleteId = null;
    this.requestUpdate();
  };

  private _formatDate(date: string | Date) {
    return new Date(date).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  override render() {
    const rows = this.tableCtrl.viewRows.value;
    const sortState = this.tableCtrl.sortState.value;
    const { page, pageSize } = this.tableCtrl.pagination.value;
    const totalItems = this.tableCtrl.totalItems.value;

    return html`
      <div class="mx-auto mt-6 max-w-6xl p-4 pb-24">
        <!-- Toolbar -->
        <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 class="text-2xl font-bold text-zinc-900">${t("notes.title")}</h1>
          <div class="flex items-center gap-3">
             <button 
                @click=${() => runClientUnscoped(navigate("/"))}
                class="rounded-md bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50"
             >
                Grid View
             </button>
             <table-search 
                .value=${this.tableCtrl.searchQuery.value} 
                @search=${this._handleSearch}
             ></table-search>
          </div>
        </div>

        <!-- Table Container -->
        <div class="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow">
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-zinc-200 table-fixed">
              <thead class="bg-zinc-50">
                <tr>
                  <!-- Title: Flexible width -->
                  <th scope="col" class="w-full px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                    <table-header 
                      label="Title" 
                      sortKey="title" 
                      .currentSort=${sortState} 
                      @sort=${this._handleSort}
                    ></table-header>
                  </th>
                  
                  <!-- Updated At: Hidden on Mobile, Fixed width on Desktop -->
                  <th scope="col" class="hidden w-40 px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 sm:table-cell">
                    <table-header 
                      label="Updated" 
                      sortKey="updated_at" 
                      .currentSort=${sortState} 
                      @sort=${this._handleSort}
                    ></table-header>
                  </th>
                  
                  <!-- Actions: Fixed width small -->
                  <th scope="col" class="relative w-16 px-6 py-3">
                    <span class="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-200 bg-white">
                ${repeat(
                  rows,
                  (note) => note.id,
                  (note) => html`
                    <tr class="hover:bg-zinc-50 transition-colors group">
                      <!-- Cell: Title (Truncated) -->
                      <td class="px-6 py-4">
                        <div class="flex items-center">
                          <a 
                            href="/notes/${note.id}"
                            class="font-medium text-zinc-900 hover:text-blue-600 hover:underline cursor-pointer truncate max-w-[150px] sm:max-w-xs md:max-w-md lg:max-w-lg"
                            @click=${(e: Event) => {
                              e.preventDefault();
                              this._navigateToNote(note.id);
                            }}
                            title=${note.title || t("common.untitled_note")}
                          >
                            ${note.title || t("common.untitled_note")}
                          </a>
                        </div>
                      </td>
                      
                      <!-- Cell: Date (Hidden on Mobile) -->
                      <td class="hidden px-6 py-4 text-sm text-zinc-500 sm:table-cell whitespace-nowrap">
                        ${this._formatDate(note.updated_at)}
                      </td>
                      
                      <!-- Cell: Actions -->
                      <td class="px-6 py-4 text-right text-sm font-medium">
                        <!-- Direct use of dropdown-menu for reliable slot projection -->
                        <dropdown-menu>
                          <!-- Trigger Button (Visible always) -->
                          <button
                            slot="trigger"
                            class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 focus:outline-none"
                          >
                            <span class="sr-only">Open options</span>
                            <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                          </button>

                          <!-- Content (Hidden until opened) -->
                          <div slot="content" class="min-w-[160px] py-1">
                             <button
                                class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                @click=${() => this._confirmDelete(note.id)}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                ${t("common.delete")}
                              </button>
                          </div>
                        </dropdown-menu>
                      </td>
                    </tr>
                  `
                )}
                
                ${rows.length === 0 ? html`
                    <tr>
                        <td colspan="3" class="px-6 py-12 text-center text-sm text-zinc-500 italic">
                            No notes found.
                        </td>
                    </tr>
                ` : ''}
              </tbody>
            </table>
          </div>
          
          <table-pagination
            .page=${page}
            .pageSize=${pageSize}
            .totalItems=${totalItems}
            @page-change=${this._handlePageChange}
          ></table-pagination>
        </div>

        <confirm-dialog
          .open=${!!this._deleteId}
          heading=${t("notes.delete_confirm_title")}
          description=${t("notes.delete_confirm_desc")}
          confirmText=${t("common.delete")}
          cancelText=${t("common.cancel")}
          @cancel=${this._cancelDelete}
          @confirm=${this._executeDelete}
        ></confirm-dialog>
      </div>
    `;
  }
}
