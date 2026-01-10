// FILE: src/components/ui/sync-status.ts
import { LitElement, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import {
  syncStatusState,
  pendingMutationCountState,
  dirtyEditorsCountState,
  lastErrorState,
  isOnlineState,
} from "../../lib/client/stores/syncStore";

@customElement("sync-status")
export class SyncStatus extends LitElement {
  private _disposeEffect?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    this._disposeEffect = effect(() => {
      void syncStatusState.value;
      void pendingMutationCountState.value;
      void dirtyEditorsCountState.value;
      void lastErrorState.value;
      void isOnlineState.value;
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

  override render() {
    const isOnline = isOnlineState.value;
    const status = syncStatusState.value;
    const pendingCount = pendingMutationCountState.value;
    const dirtyCount = dirtyEditorsCountState.value;
    const lastError = lastErrorState.value;

    if (!isOnline) {
      return html`
        <div class="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 border border-zinc-200 select-none">
          <div class="h-1.5 w-1.5 rounded-full bg-zinc-400"></div>
          Offline
          ${(pendingCount + dirtyCount) > 0 ? html`<span class="ml-0.5 font-bold">(${pendingCount + dirtyCount})</span>` : nothing}
        </div>
      `;
    }

    if (status === "error") {
        return html`
        <div class="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 border border-red-200 select-none cursor-help" title=${lastError || "Sync Error"}>
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          Sync Error
        </div>
      `;
    }

    // ✅ FIX: Stay in "Saving" state if editor is debouncing (dirtyCount > 0)
    // This ensures E2E tests waiting for "Saved" won't reload too early.
    if (status === "syncing" || pendingCount > 0 || dirtyCount > 0) {
        const total = pendingCount + dirtyCount;
        return html`
        <div class="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-200 select-none">
          <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.282M20 20v-5h-.282M15 15l-3 3-3-3M9 9l3-3 3 3" /></svg>
          ${total > 0 ? `Saving (${total})...` : "Syncing..."}
        </div>
      `;
    }

    return html`
        <div class="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 border border-green-200 select-none">
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7" /></svg>
          Saved
        </div>
    `;
  }
}
