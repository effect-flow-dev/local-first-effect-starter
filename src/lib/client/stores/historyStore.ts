// FILE: src/lib/client/stores/historyStore.ts
import { signal } from "@preact/signals-core";
import { Effect } from "effect";
import { api } from "../api";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";
import type { HistoryEntry } from "../../shared/schemas";

// --- State ---
export const historyEntries = signal<HistoryEntry[]>([]);
export const isHistoryOpen = signal(false);
export const isLoadingHistory = signal(false);
export const historyError = signal<string | null>(null);

// --- Actions ---

export const closeHistory = () => {
  isHistoryOpen.value = false;
};

export const openHistory = (noteId: string) => {
  isHistoryOpen.value = true;
  isLoadingHistory.value = true;
  historyError.value = null;
  historyEntries.value = [];

  const fetchEffect = Effect.gen(function* () {
    yield* clientLog("info", `[HistoryStore] Fetching history for note ${noteId}`);

    // ✅ FIX: Get token and add headers
    const token = localStorage.getItem("jwt");
    if (!token) {
        historyError.value = "Not authenticated";
        isLoadingHistory.value = false;
        return;
    }

    const response = yield* Effect.tryPromise(() =>
      api.api.notes({ id: noteId }).history.get({
          headers: {
              Authorization: `Bearer ${token}`
          }
      })
    );

    if (response.error) {
      const msg = typeof response.error.value === 'string' 
        ? response.error.value 
        : "Failed to load history";
      historyError.value = msg;
      yield* clientLog("error", `[HistoryStore] Fetch failed: ${msg}`);
    } else if (response.data && "history" in response.data) {
      historyEntries.value = response.data.history as unknown as HistoryEntry[];
      yield* clientLog("info", `[HistoryStore] Loaded ${response.data.history.length} entries.`);
    }

    isLoadingHistory.value = false;
  });

  runClientUnscoped(
    fetchEffect.pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.error(err);
          historyError.value = "Network error occurred.";
          isLoadingHistory.value = false;
        })
      )
    )
  );
};
