// FILE: src/components/ui/sync-status.ts
import { LitElement, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import {
  syncStatusState,
  pendingMutationCountState,
  lastErrorState,
  isOnlineState,
} from "../../lib/client/stores/syncStore";
import { clientLog } from "../../lib/client/clientLog";
import { runClientUnscoped } from "../../lib/client/runtime";

@customElement("sync-status")
export class SyncStatus extends LitElement {
  private _disposeEffect?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    runClientUnscoped(clientLog("debug", "<sync-status> connected"));
    
    this._disposeEffect = effect(() => {
      // Subscribe to all relevant signals so the component updates
      // whenever any of these change.
      void syncStatusState.value;
      void pendingMutationCountState.value;
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
    // Render into Light DOM so global Tailwind classes apply
    return this; 
  }

  override render() {
    const isOnline = isOnlineState.value;
    const status = syncStatusState.value;
    const pendingCount = pendingMutationCountState.value;
    const lastError = lastErrorState.value;

    // 1. Offline (Highest Priority visual warning)
    if (!isOnline) {
      return html`
        <div 
          class="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 border border-zinc-200 select-none" 
          title="You are offline. Changes will sync when connection is restored."
        >
          <div class="h-1.5 w-1.5 rounded-full bg-zinc-400"></div>
          Offline
          ${pendingCount > 0 ? html`<span class="ml-0.5 font-bold">(${pendingCount})</span>` : nothing}
        </div>
      `;
    }

    // 2. Error
    if (status === "error") {
        return html`
        <div 
          class="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 border border-red-200 select-none cursor-help" 
          title=${lastError || "Unknown Sync Error"}
        >
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Sync Error
        </div>
      `;
    }

    // 3. Syncing or Pending Mutations
    if (status === "syncing" || pendingCount > 0) {
        return html`
        <div class="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-200 select-none">
          <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.282M20 20v-5h-.282M15 15l-3 3-3-3M9 9l3-3 3 3" />
          </svg>
          ${pendingCount > 0 ? `Saving (${pendingCount})...` : "Syncing..."}
        </div>
      `;
    }

    // 4. Synced (Idle)
    return html`
        <div class="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 border border-green-200 select-none">
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Saved
        </div>
    `;
  }
}
