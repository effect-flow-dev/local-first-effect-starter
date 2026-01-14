// File: ./src/components/features/history-sidebar.ts
// FILE: src/components/features/history-sidebar.ts
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";
import { effect } from "@preact/signals-core";
import { Effect } from "effect";
import {
  historyEntries,
  isHistoryOpen,
  isLoadingHistory,
  historyError,
  closeHistory,
} from "../../lib/client/stores/historyStore";
import type { HistoryEntry, TiptapDoc, NotebookId } from "../../lib/shared/schemas";
import { ReplicacheService } from "../../lib/client/replicache";
import { runClientUnscoped } from "../../lib/client/runtime";
import { convertTiptapToMarkdown } from "../../lib/client/logic/markdown-transformer";

@customElement("history-sidebar")
export class HistorySidebar extends LitElement {
  private _disposeEffect?: () => void;

  @state()
  private _previewEntryId: string | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.style.display = "contents";
    
    this._disposeEffect = effect(() => {
      void isHistoryOpen.value;
      void historyEntries.value;
      void isLoadingHistory.value;
      
      if (!isHistoryOpen.value) {
        this._previewEntryId = null;
      }
      
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  protected override createRenderRoot() {
    return this; 
  }

  private _formatDeviceDate(dateVal: string | Date) {
    try {
      const date = new Date(dateVal);
      return new Intl.DateTimeFormat("default", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      }).format(date);
    } catch {
      return "Unknown date";
    }
  }

  private _formatDelta(mutationType: string, delta: unknown): string {
    if (mutationType === "createNote") return "Created note";
    if (mutationType === "deleteNote") return "Deleted note";
    if (mutationType === "revertBlock") return "Restored block version";
    if (mutationType === "revertNote") return "Restored note version";
    
    if (typeof delta !== "object" || delta === null) return JSON.stringify(delta);

    const d = delta as Record<string, unknown>;

    // Handle Location Context Updates
    // ✅ FIX: Safely cast unknown properties before using in template literals
    const entityId = d.entityId as string | undefined;
    const locationSource = d.locationSource as string | undefined;
    const locationAccuracy = d.locationAccuracy as number | undefined;

    if (entityId || locationSource) {
        const source = locationSource || "manual";
        if (entityId) return `Linked to Entity (${source})`;
        if (locationSource === 'gps') return `Updated via GPS (±${locationAccuracy ?? '?'}m)`;
        if (locationSource === 'manual') return `Manually moved location`;
    }

    if (mutationType === "updateTask") {
      if (typeof d.isComplete === "boolean") {
        return d.isComplete ? "Completed task" : "Unchecked task";
      }
    }

    if (mutationType === "updateBlock") {
      if (d.fields && typeof d.fields === "object" && d.fields !== null) {
        const fields = d.fields as Record<string, unknown>;
        const keys = Object.keys(fields);
        
        if (keys.includes("status")) {
          const val = fields.status;
          return `Status changed to '${typeof val === 'string' ? val : String(val)}'`;
        }
        if (keys.length > 0) {
          return `Updated block: ${keys.join(", ")}`;
        }
      }
    }

    if (mutationType === "updateNote") {
      if (typeof d.title === "string" && d.title) {
        return `Renamed to "${d.title}"`;
      }
      if (d.content) return "Updated note content";
    }

    return mutationType;
  }

  private _handleRestoreBlock(e: Event, entry: HistoryEntry) {
    e.stopPropagation();
    if (!entry.block_id) return;

    const delta = entry.change_delta as Record<string, unknown>;
    let targetSnapshot: Record<string, unknown> = {};

    if (entry.mutation_type === "updateTask") {
        const isComplete = Boolean(delta.isComplete);
        targetSnapshot = {
            fields: {
                is_complete: isComplete,
                status: isComplete ? "done" : "todo"
            }
        };
    } else if (entry.mutation_type === "updateBlock") {
        targetSnapshot = {
            fields: delta.fields
        };
    } else {
        return;
    }

    runClientUnscoped(
      Effect.gen(function* () {
        const replicache = yield* ReplicacheService;
        yield* Effect.promise(() => 
            replicache.client.mutate.revertBlock({
                blockId: entry.block_id,
                historyId: entry.id,
                targetSnapshot
            })
        );
      })
    );

    closeHistory();
  }

  private _handleRestoreNote(e: Event, entry: HistoryEntry) {
    e.stopPropagation();
    if (entry.mutation_type !== "updateNote") return;

    const args = entry.change_delta as { title: string; content: TiptapDoc; notebookId?: string };

    runClientUnscoped(
      Effect.gen(function* () {
        const replicache = yield* ReplicacheService;
        yield* Effect.promise(() => 
            replicache.client.mutate.revertNote({
                noteId: entry.note_id,
                historyId: entry.id,
                targetSnapshot: {
                    title: args.title,
                    content: args.content,
                    notebookId: args.notebookId as NotebookId | undefined
                }
            })
        );
      })
    );
    
    this._previewEntryId = null;
    closeHistory();
  }

  private _togglePreview(entry: HistoryEntry) {
    if (entry.mutation_type !== "updateNote") return;
    this._previewEntryId = (this._previewEntryId === entry.id) ? null : entry.id;
  }

  private _renderPreviewPanel() {
    const entries = historyEntries.value;
    const entry = entries.find(e => e.id === this._previewEntryId);
    
    if (!entry || entry.mutation_type !== "updateNote") return nothing;

    const args = entry.change_delta as { title?: string; content?: TiptapDoc };
    let previewText = "";

    if (args.content) {
        try {
            previewText = convertTiptapToMarkdown(args.content);
            if (previewText.length > 5000) previewText = previewText.slice(0, 5000) + "...";
        } catch {
            previewText = "(Complex content)";
        }
    }

    return html`
        <div 
            class="fixed top-4 bottom-4 left-4 right-[21rem] z-[65] flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl transition-all animate-in slide-in-from-right-4 fade-in duration-200"
            @click=${(e: Event) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/50 px-4 py-3">
                <h4 class="font-semibold text-zinc-900">Version Preview</h4>
                <button 
                    class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                    title="Close Preview"
                    @click=${() => this._previewEntryId = null}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            
            <div class="flex-1 overflow-y-auto p-8">
                ${args.title ? html`<div class="mb-6 text-3xl font-bold text-zinc-900">${args.title}</div>` : nothing}
                ${previewText 
                    ? html`<div class="prose prose-zinc max-w-none whitespace-pre-wrap">${previewText}</div>` 
                    : html`<div class="italic text-zinc-400">No content changes in this version.</div>`
                }
            </div>

            <div class="border-t border-zinc-100 bg-zinc-50 p-4">
                 <button
                    class="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    @click=${(e: Event) => this._handleRestoreNote(e, entry)}
                >
                    Restore This Version
                </button>
            </div>
        </div>
    `;
  }

  private _getIcon(type: string) {
    if (type.includes("create")) return html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`;
    if (type.includes("delete")) return html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    if (type.includes("revert")) return html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
    return html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  }

  // ✅ FIX: Use HistoryEntry type and intersect with database fields
  // This avoids 'any' and unsafe member access errors.
  private _renderSourceBadge(entry: HistoryEntry) {
    const e = entry as HistoryEntry & { location_source?: string | null };
    const source = e.location_source;
    
    if (!source) return nothing;

    if (source === 'entity_fixed') {
        return html`<span class="ml-auto text-[10px] uppercase font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded">Fixed Asset</span>`;
    }
    if (source === 'gps') {
        return html`<span class="ml-auto text-[10px] uppercase font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">GPS</span>`;
    }
    
    return nothing;
  }

  override render() {
    const isOpen = isHistoryOpen.value;
    
    const entries = [...historyEntries.value].sort((a, b) => 
        b.hlc_timestamp.localeCompare(a.hlc_timestamp)
    );
    
    const loading = isLoadingHistory.value;
    const error = historyError.value;

    const backdropDynamic = {
      "opacity-0": !isOpen,
      "pointer-events-none": !isOpen,
      "opacity-100": isOpen,
    };

    const sidebarDynamic = {
      "translate-x-full": !isOpen,
      "translate-x-0": isOpen,
    };

    return html`
      <div 
        class="fixed inset-0 z-[60] bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${classMap(backdropDynamic)}" 
        @click=${closeHistory}
      ></div>

      ${isOpen && this._previewEntryId ? this._renderPreviewPanel() : nothing}

      <div 
        class="fixed top-0 right-0 z-[70] h-full w-80 bg-white shadow-2xl transition-transform duration-300 ease-in-out border-l border-zinc-200 ${classMap(sidebarDynamic)}"
      >
        <div class="flex h-full flex-col">
          <div class="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <h3 class="font-semibold text-zinc-800">Version History</h3>
            <button
              @click=${closeHistory}
              class="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-4">
            ${loading ? html`<div class="py-8 text-center text-zinc-500">Loading history...</div>` : nothing}
            ${error ? html`<div class="rounded-md bg-red-50 p-4 text-sm text-red-600">${error}</div>` : nothing}
            ${!loading && !error && entries.length === 0 ? html`<div class="py-8 text-center text-sm text-zinc-400">No history available.</div>` : nothing}

            <div class="space-y-4">
              ${repeat(entries, (entry) => entry.id, (entry) => {
                  const isSelected = this._previewEntryId === entry.id;
                  const isInteractive = entry.mutation_type === "updateNote";
                  
                  return html`
                  <div 
                    class="group relative flex flex-col gap-1 rounded-md p-2 transition-all duration-200 ${isInteractive ? 'cursor-pointer hover:bg-zinc-50' : ''} ${isSelected ? 'bg-blue-50/50 ring-1 ring-blue-200 shadow-sm' : ''}"
                    @click=${() => this._togglePreview(entry)}
                  >
                    <div class="flex gap-3">
                        <div class="absolute left-[19px] top-8 bottom-[-16px] w-px bg-zinc-200 last:hidden"></div>
                        <div class="relative z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-white text-zinc-500 ${isSelected ? 'border-blue-200 text-blue-600' : 'border-zinc-200'}">
                            ${this._getIcon(entry.mutation_type)}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between">
                                <p class="text-sm font-medium ${isSelected ? 'text-blue-900' : 'text-zinc-900'}">
                                    ${this._formatDelta(entry.mutation_type, entry.change_delta)}
                                </p>
                                ${this._renderSourceBadge(entry)}
                            </div>
                            <div class="mt-0.5 flex flex-col gap-0.5 text-xs text-zinc-500">
                                <span title="Physical device time recorded at source">
                                    Device: ${this._formatDeviceDate(entry.device_timestamp as unknown as string)}
                                </span>
                                <span title="Hybrid Logical Clock sequence identifier">
                                    Causal: ${entry.hlc_timestamp.split(':')[1]} (T+${entry.hlc_timestamp.split(':')[0]?.slice(-4)})
                                </span>
                            </div>
                        </div>
                        
                        ${["updateTask", "updateBlock"].includes(entry.mutation_type) ? html`
                            <button
                            class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 rounded bg-white px-2 py-1 text-xs font-medium text-blue-600 shadow-sm ring-1 ring-zinc-200 hover:bg-blue-50 transition-all"
                            @click=${(e: Event) => this._handleRestoreBlock(e, entry)}
                            >
                            Restore
                            </button>
                        ` : nothing}
                    </div>
                  </div>
                `;
              })}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
