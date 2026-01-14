// File: ./src/components/editor/node-views/file-attachment-node-view.ts
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Effect, Fiber, Schedule } from "effect";
import {
  getPendingMedia,
  getFromMemoryCache,
  touchMedia,
} from "../../../lib/client/media/mediaStore";
import { MediaSyncService } from "../../../lib/client/media/MediaSyncService";
import type { PendingUpload } from "../../../lib/client/media/types";
import { runClientUnscoped } from "../../../lib/client/runtime";
import { clientLog } from "../../../lib/client/clientLog";
import "../../ui/confirm-dialog"; // ✅ Import ConfirmDialog

const formatBytes = (bytes: number, decimals = 1) => {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

@customElement("file-attachment-node-view")
export class FileAttachmentNodeView extends LitElement {
  @property({ type: String }) filename = "Unknown File";
  @property({ type: Number }) size = 0;
  @property({ type: String }) mimeType = "application/octet-stream";
  @property({ type: String }) url = "";
  @property({ type: String }) uploadId = "";

  @state() private _uploadStatus: PendingUpload | null = null;
  @state() private _isOfflineCached = false;
  @state() private _localBlobUrl: string | null = null;
  @state() private _isDeleteModalOpen = false; // ✅ Delete state

  private _pollFiber: Fiber.RuntimeFiber<void, unknown> | null = null;

  protected override createRenderRoot() {
    return this; // Light DOM for Tailwind
  }

  override connectedCallback() {
    super.connectedCallback();
    this._init();
    this._checkOfflineAvailability();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._cleanup();
  }

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has("url")) {
        runClientUnscoped(clientLog("debug", `[FileAttachment] URL updated to: ${this.url}`));
        this._checkOfflineAvailability();
    }

    if (this.uploadId && !this._localBlobUrl) {
      const cached = getFromMemoryCache(this.uploadId);
      if (cached) {
        this._localBlobUrl = cached;
        // ✅ Read-Through Tracking
        runClientUnscoped(touchMedia(this.uploadId));
      }
    }

    if (changedProperties.has("uploadId") && this.uploadId) {
        // Re-init logic if uploadId changed (e.g. initial sync)
        this._init();
    }
  }

  private _init() {
    // ✅ FIX: Always try to load local blob if uploadId is present
    if (this.uploadId) {
        // This sets _localBlobUrl if successful, enabling offline/instant access
        this._loadLocalBlob(); 
        
        // Only start polling if we are truly pending (no URL)
        if (!this.url) {
            this._startPolling();
        }
    }
  }

  private _cleanup() {
    if (this._pollFiber) {
      runClientUnscoped(Fiber.interrupt(this._pollFiber));
      this._pollFiber = null;
    }
  }

  private _loadLocalBlob() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    runClientUnscoped(Effect.gen(function*() {
        const item = yield* getPendingMedia(self.uploadId);
        if (item && item.file) {
            self._localBlobUrl = URL.createObjectURL(item.file);
            self._isOfflineCached = true;
            yield* touchMedia(self.uploadId);
        }
    }).pipe(
        // Silent fail on load error, we fallback to URL in render
        Effect.catchAll(() => Effect.void)
    ));
  }

  private _startPolling() {
    if (this._pollFiber) return;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    const pollEffect = Effect.gen(function* () {
      const item = yield* getPendingMedia(self.uploadId);
      if (item) {
        self._uploadStatus = item;
        // ✅ Touch media on poll update
        yield* touchMedia(self.uploadId);
      }
    }).pipe(
      Effect.catchAll((e) => Effect.logError("Polling error", e)),
      Effect.repeat(Schedule.spaced("1 second")),
      Effect.asVoid,
    );

    this._pollFiber = runClientUnscoped(pollEffect);
  }

  private _checkOfflineAvailability() {
    if (!this.url) return;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    
    // Check if the file is in the Service Worker cache
    runClientUnscoped(Effect.gen(function*() {
        if ('caches' in window) {
            // Check standard media cache (SW)
            const cache = yield* Effect.promise(() => caches.open("media-cache"));
            const match = yield* Effect.promise(() => cache.match(self.url));
            if (match) {
                self._isOfflineCached = true;
            }
        }
    }).pipe(
        Effect.catchAll(() => Effect.void)
    ));
  }

  private _handleRetry = (e: Event) => {
    e.stopPropagation();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    
    if (this._uploadStatus) {
        this._uploadStatus = { ...this._uploadStatus, status: "uploading", lastError: null };
    }

    runClientUnscoped(
      Effect.gen(function* () {
        const service = yield* MediaSyncService;
        yield* service.queueUpload(self.uploadId);
        yield* clientLog("info", `[FileAttachment] Manual retry for ${self.uploadId}`);
      }),
    );
  };

  private _handleDownload = (e: Event) => {
      e.stopPropagation(); // Prevent editor selection issues
      
      // ✅ Explicit Touch on Interaction
      if (this.uploadId) {
          runClientUnscoped(touchMedia(this.uploadId));
      }
  };

  // ✅ Delete Handlers
  private _openDeleteModal = (e: Event) => {
    e.stopPropagation();
    runClientUnscoped(clientLog("debug", "[FileAttachment] Delete trash icon clicked"));
    this._isDeleteModalOpen = true;
  };

  private _confirmDelete = () => {
    runClientUnscoped(clientLog("info", "[FileAttachment] Confirming delete in modal..."));
    this._isDeleteModalOpen = false;
    
    const event = new CustomEvent("delete-block", {
      bubbles: true,
      composed: true,
    });
    
    this.dispatchEvent(event);
    runClientUnscoped(clientLog("info", "[FileAttachment] Dispatched 'delete-block' event"));
  };

  private _cancelDelete = () => {
    this._isDeleteModalOpen = false;
  };

  private _getFileIcon() {
    const type = this.mimeType;
    if (type.includes("pdf")) {
        return html`<svg class="w-8 h-8 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>`;
    }
    if (type.includes("sheet") || type.includes("csv") || type.includes("excel")) {
        return html`<svg class="w-8 h-8 text-green-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>`;
    }
    if (type.includes("zip") || type.includes("compressed")) {
        return html`<svg class="w-8 h-8 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>`;
    }
    // Default Document
    return html`<svg class="w-8 h-8 text-zinc-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>`;
  }

  override render() {
    const status = this._uploadStatus?.status || "pending";
    const isError = status === "error";
    const isUploading = status === "uploading" || status === "pending";
    const isDone = !!this.url;

    // Prioritize URL if available (complete upload), otherwise fall back to local blob (preview)
    const downloadLink = this.url || this._localBlobUrl;

    // ✅ FIX: Ensure we have a valid download link to render
    if (!downloadLink && !isUploading && !isError) {
        runClientUnscoped(clientLog("warn", "[FileAttachment] No download link available", { url: this.url, blob: this._localBlobUrl }));
    }

    return html`
      <div class="my-3 select-none">
        <div class="flex items-center gap-3 p-3 rounded-lg border bg-white shadow-sm transition-all hover:shadow-md ${isError ? 'border-red-300 bg-red-50' : 'border-zinc-200'}">
            
            <!-- Icon -->
            <div class="shrink-0">
                ${this._getFileIcon()}
            </div>

            <!-- Info -->
            <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-zinc-900 truncate" title="${this.filename}">
                    ${this.filename}
                </div>
                <div class="text-xs text-zinc-500 flex items-center gap-2">
                    <span>${formatBytes(this.size)}</span>
                    ${isUploading && !isDone ? html`<span class="text-amber-600 font-semibold animate-pulse">Uploading...</span>` : nothing}
                    ${isError ? html`<span class="text-red-600 font-bold">Upload Failed</span>` : nothing}
                    ${this._isOfflineCached ? html`<span class="text-green-600 font-medium" title="Available Offline">Saved locally</span>` : nothing}
                </div>
            </div>

            <!-- Actions -->
            <div class="shrink-0 flex items-center gap-2">
                ${isError 
                    ? html`
                        <button @click=${this._handleRetry} class="p-1.5 rounded-full hover:bg-red-100 text-red-600 transition-colors" title="Retry Upload">
                            <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.282M20 20v-5h-.282M15 15l-3 3-3-3M9 9l3-3 3 3" /></svg>
                        </button>`
                    : nothing 
                }

                ${downloadLink 
                    ? html`
                        <a 
                            href="${downloadLink}" 
                            download="${this.filename}" 
                            target="_blank"
                            class="p-1.5 rounded-full hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 transition-colors ${!isDone && !this._localBlobUrl ? 'opacity-50 pointer-events-none' : ''}"
                            title="Download"
                            @click=${this._handleDownload}
                        >
                            <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </a>`
                    : nothing
                }

                <!-- ✅ DELETE BUTTON -->
                <button 
                  @click=${this._openDeleteModal} 
                  class="p-1.5 rounded-full hover:bg-red-100 text-zinc-400 hover:text-red-600 transition-colors"
                  title="Delete File"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
            </div>
        </div>
        
        ${isError && this._uploadStatus?.lastError 
            ? html`<div class="mt-1 text-xs text-red-600 px-1">${this._uploadStatus.lastError}</div>` 
            : nothing
        }

        <confirm-dialog
          .open=${this._isDeleteModalOpen}
          heading="Delete File"
          description="Are you sure you want to delete this file? This cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          @confirm=${this._confirmDelete}
          @cancel=${this._cancelDelete}
        ></confirm-dialog>
      </div>
    `;
  }
}
