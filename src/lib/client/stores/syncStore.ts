// FILE: src/lib/client/stores/syncStore.ts
import { signal } from "@preact/signals-core";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../clientLog";

export type SyncStatus = "synced" | "syncing" | "error" | "offline";

/**
 * High-level status of the sync process.
 */
export const syncStatusState = signal<SyncStatus>("synced");

/**
 * The number of local mutations that have not yet been confirmed by the server.
 */
export const pendingMutationCountState = signal<number>(0);

/**
 * Track how many editor components have unsaved changes (debouncing).
 */
export const dirtyEditorsCountState = signal<number>(0);

/**
 * The last error message encountered during sync, if any.
 */
export const lastErrorState = signal<string | null>(null);

/**
 * Browser online/offline status (navigator.onLine).
 */
export const isOnlineState = signal<boolean>(
  typeof navigator !== "undefined" ? navigator.onLine : true
);

// --- Actions ---

export const incrementDirtyEditors = () => {
    dirtyEditorsCountState.value++;
};

export const decrementDirtyEditors = () => {
    dirtyEditorsCountState.value = Math.max(0, dirtyEditorsCountState.value - 1);
};

export const setSyncing = (isSyncing: boolean) => {
  const current = syncStatusState.peek();
  if (isSyncing) {
    if (current !== "offline" && current !== "error") {
      syncStatusState.value = "syncing";
    }
  } else {
    if (current === "syncing") {
      syncStatusState.value = "synced";
    }
  }
};

export const setError = (error: string | null) => {
  if (error) {
    runClientUnscoped(clientLog("error", `[SyncStore] Sync Error: ${error}`));
    lastErrorState.value = error;
    syncStatusState.value = "error";
  } else {
    lastErrorState.value = null;
    if (!isOnlineState.peek()) {
      syncStatusState.value = "offline";
    } else {
      syncStatusState.value = "synced";
    }
  }
};

export const updatePendingCount = (count: number) => {
  if (pendingMutationCountState.peek() !== count) {
    pendingMutationCountState.value = count;
  }
};

export const setOnline = (online: boolean) => {
  const previous = isOnlineState.peek();
  if (previous !== online) {
    isOnlineState.value = online;
    runClientUnscoped(clientLog("info", `[SyncStore] Network status: ${online ? "ONLINE" : "OFFLINE"}`));
    
    if (!online) {
      syncStatusState.value = "offline";
    } else {
      if (syncStatusState.peek() === "offline") {
        syncStatusState.value = "synced";
      }
    }
  }
};
