// FILE: src/lib/client/stores/syncStore.ts
import { signal } from "@preact/signals-core";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../clientLog";

export type SyncStatus = "synced" | "syncing" | "error" | "offline";

// --- State Signals ---

/**
 * High-level status of the sync process.
 */
export const syncStatusState = signal<SyncStatus>("synced");

/**
 * The number of local mutations that have not yet been confirmed by the server.
 */
export const pendingMutationCountState = signal<number>(0);

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

export const setSyncing = (isSyncing: boolean) => {
  // Only update if we are not currently offline or in an error state
  // (unless we are clearing the syncing flag, which should always happen)
  const current = syncStatusState.peek();
  
  if (isSyncing) {
    if (current !== "offline" && current !== "error") {
      syncStatusState.value = "syncing";
    }
  } else {
    // If stopping sync, revert to synced only if we aren't offline/error
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
    // If clearing error, check online status to decide next state
    if (!isOnlineState.peek()) {
      syncStatusState.value = "offline";
    } else {
      // Optimistically set to synced; actual sync cycle will switch to 'syncing' if needed
      syncStatusState.value = "synced";
    }
  }
};

export const updatePendingCount = (count: number) => {
  if (pendingMutationCountState.peek() !== count) {
    pendingMutationCountState.value = count;
    // Optional: Log debug if pending count builds up significantly
    if (count > 5) {
        runClientUnscoped(clientLog("debug", `[SyncStore] High pending mutation count: ${count}`));
    }
  }
};

export const setOnline = (online: boolean) => {
  const previous = isOnlineState.peek();
  if (previous !== online) {
    isOnlineState.value = online;
    runClientUnscoped(clientLog("info", `[SyncStore] Network status changed: ${online ? "ONLINE" : "OFFLINE"}`));
    
    if (!online) {
      syncStatusState.value = "offline";
    } else {
      // When coming back online, clear explicit offline status.
      // Replicache will trigger 'syncing' shortly after.
      if (syncStatusState.peek() === "offline") {
        syncStatusState.value = "synced";
      }
    }
  }
};
