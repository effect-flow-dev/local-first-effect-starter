// FILE: src/components/editor/node-views/image-block-node-view.ts
import {
  LitElement,
  html,
  nothing,
  type TemplateResult,
  type PropertyValues,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Effect, Fiber, Schedule } from "effect";
import {
  getPendingMedia,
  getFromMemoryCache,
  clearMemoryCache,
} from "../../../lib/client/media/mediaStore";
import { MediaSyncService } from "../../../lib/client/media/MediaSyncService";
import type { PendingUpload } from "../../../lib/client/media/types";
import { runClientUnscoped } from "../../../lib/client/runtime";
import { clientLog } from "../../../lib/client/clientLog";
import "../../ui/confirm-dialog"; // Ensure dialog is registered

@customElement("image-block-node-view")
export class ImageBlockNodeView extends LitElement {
  @property({ type: String })
  url: string = "";

  @property({ type: String })
  uploadId: string = "";

  @property({ type: Number })
  width: number | null = null;

  @state()
  private _localBlobUrl: string | null = null;

  @state()
  private _uploadStatus: PendingUpload | null = null;

  @state()
  private _isError = false;

  @state()
  private _isDeleteModalOpen = false;

  private _pollFiber: Fiber.RuntimeFiber<void, unknown> | null = null;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._cleanup();
  }

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (this.uploadId && !this._localBlobUrl) {
      const cached = getFromMemoryCache(this.uploadId);
      if (cached) {
        this._localBlobUrl = cached;
      }
    }

    const prevUploadId = changedProperties.get("uploadId");
    const isFinishingUpload = prevUploadId && !this.uploadId && this.url;

    if (isFinishingUpload) {
      return;
    }

    if (changedProperties.has("url") || changedProperties.has("uploadId")) {
      if (
        changedProperties.get("uploadId") !== undefined ||
        changedProperties.get("url") !== undefined
      ) {
        this._cleanup();
        this._init();
      }
    }
  }

  private _init() {
    if (this.url) return;

    if (this.uploadId) {
      this._loadBlob();
      this._startPolling();
    }
  }

  private _cleanup() {
    this._localBlobUrl = null;
    if (this._pollFiber) {
      runClientUnscoped(Fiber.interrupt(this._pollFiber));
      this._pollFiber = null;
    }
  }

  private _loadBlob() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    const loadEffect = Effect.gen(function* () {
      const item = yield* getPendingMedia(self.uploadId);
      if (item && item.file) {
        const newUrl = URL.createObjectURL(item.file);
        self._localBlobUrl = newUrl;
        self._isError = false;
        clearMemoryCache(self.uploadId);
        return;
      }
      return yield* Effect.fail(new Error("Pending media not found in IDB"));
    });

    const retryPolicy = Schedule.exponential("50 millis").pipe(
      Schedule.compose(Schedule.recurs(10)),
    );

    runClientUnscoped(
      loadEffect.pipe(
        Effect.retry(retryPolicy),
        Effect.catchAll((e) =>
          Effect.sync(() => {
            if (!self._localBlobUrl) {
              console.warn(
                `[ImageBlock] Failed to load local blob for ${self.uploadId}`,
                e,
              );
              self._isError = true;
            }
          }),
        ),
      ),
    );
  }

  private _startPolling() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    const pollEffect = Effect.gen(function* () {
      const item = yield* getPendingMedia(self.uploadId);
      if (item) {
        self._uploadStatus = item;
        if (!self._localBlobUrl && item.file) {
          self._localBlobUrl = URL.createObjectURL(item.file);
          self._isError = false;
        }
      }
    }).pipe(
      Effect.catchAll((e) => Effect.logError("Polling error", e)),
      Effect.repeat(Schedule.spaced("1 second")),
      Effect.asVoid,
    );

    this._pollFiber = runClientUnscoped(pollEffect);
  }

  private _handleRetry = (e: Event) => {
    e.stopPropagation();
    if (this._uploadStatus) {
      this._uploadStatus = {
        ...this._uploadStatus,
        status: "uploading",
        lastError: null,
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    runClientUnscoped(
      Effect.gen(function* () {
        const service = yield* MediaSyncService;
        yield* service.queueUpload(self.uploadId);
        yield* clientLog(
          "info",
          `[ImageBlock] Manual retry for ${self.uploadId}`,
        );
      }),
    );
  };

  private _openDeleteModal = (e: Event) => {
    e.stopPropagation();
    this._isDeleteModalOpen = true;
  };

  private _confirmDelete = () => {
    this._isDeleteModalOpen = false;
    this.dispatchEvent(
      new CustomEvent("delete-block", {
        bubbles: true,
        composed: true,
      })
    );
  };

  private _cancelDelete = () => {
    this._isDeleteModalOpen = false;
  };

  override render() {
    const src = this._localBlobUrl || this.url;

    const status = this._uploadStatus?.status || "pending";
    const lastError = this._uploadStatus?.lastError;
    const retryCount = this._uploadStatus?.retryCount || 0;

    const isDone = !!this.url;
    const isFatal = !isDone && status === "error";
    const isTransient = !isDone && !isFatal && (!!lastError || retryCount > 0);
    const isUploading = !isDone && status === "uploading";

    if (!src) {
      if (this._isError) {
        return html`
          <div
            class="relative my-4 flex min-h-[100px] w-full flex-col items-center justify-center rounded-md border-2 border-red-200 bg-red-50 p-4 text-center"
          >
            <span class="mb-1 text-sm font-semibold text-red-600"
              >Image Load Failed</span
            >
          </div>
        `;
      }
      return html`<div
        class="relative my-4 min-h-[150px] w-full animate-pulse rounded-md bg-zinc-100"
      ></div>`;
    }

    let borderClass = "border-transparent";
    if (isDone) borderClass = "border-zinc-200";
    else if (isFatal) borderClass = "border-red-500";
    else if (isTransient) borderClass = "border-amber-500";

    let overlay: TemplateResult | typeof nothing = nothing;

    if (isFatal) {
      overlay = html`
        <div
          class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 p-4 text-center text-white backdrop-blur-sm"
        >
          <div class="mb-2 text-red-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          </div>
          <span class="mb-1 text-sm font-bold">Failed</span>
          <button
            @click=${this._handleRetry}
            class="mt-2 rounded bg-white px-3 py-1 text-xs font-bold text-zinc-900"
          >
            Retry
          </button>
        </div>
      `;
    } else if (isTransient) {
      overlay = html`
        <div
          class="absolute bottom-2 right-2 z-10 rounded-md bg-black/70 px-2 py-1 text-xs text-white backdrop-blur-md"
        >
          Connecting... (${retryCount})
        </div>
      `;
    } else if (isUploading) {
      overlay = html`
        <div class="absolute bottom-2 right-2 z-10">
          <div
            class="h-5 w-5 animate-spin rounded-full border-2 border-white/50 border-t-white shadow-sm"
          ></div>
        </div>
      `;
    }

    return html`
      <div
        class="group relative my-4 inline-block max-w-full overflow-hidden rounded-md border-2 transition-colors duration-300 ${borderClass}"
      >
        <img src=${src} alt="Content" class="block h-auto max-w-full" />
        ${overlay}

        <!-- Delete Button (Top Right) -->
        <button
          @click=${this._openDeleteModal}
          class="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full bg-black/50 text-white hover:bg-red-600 focus:opacity-100"
          title="Delete Image"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>

        <confirm-dialog
          .open=${this._isDeleteModalOpen}
          heading="Delete Image"
          description="Are you sure you want to delete this image? This cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          @confirm=${this._confirmDelete}
          @cancel=${this._cancelDelete}
        ></confirm-dialog>
      </div>
    `;
  }
}
