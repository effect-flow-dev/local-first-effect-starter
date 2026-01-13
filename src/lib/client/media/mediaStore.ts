// FILE: src/lib/client/media/mediaStore.ts
import { createStore, set, get, del, keys, getMany } from "idb-keyval";
import { Data, Effect } from "effect";
import type { PendingUpload, UploadStatus } from "./types";
import { clientLog } from "../clientLog";

export class MediaStorageError extends Data.TaggedError("MediaStorageError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// ✅ FIX: Use a dedicated database name to avoid "Object store not found" conflicts
// if other parts of the app (like HLC) initialized 'life-io-db' without this store.
const DB_NAME = "life-io-media-v1";
const STORE_NAME = "media-outbox";
const mediaStore = createStore(DB_NAME, STORE_NAME);

// --- Hot Cache (Instant UI) ---
const memoryCache = new Map<string, string>();

export const prewarmMemoryCache = (id: string, blobUrl: string) => {
  if (import.meta.env.DEV) {
    console.debug(`[MediaStore] 🔥 Prewarming cache for ${id}`);
  }
  memoryCache.set(id, blobUrl);
};

export const getFromMemoryCache = (id: string) => {
  const hit = memoryCache.get(id);
  if (import.meta.env.DEV) {
    console.debug(`[MediaStore] 🧊 Cache lookup for ${id}: ${hit ? "HIT" : "MISS"}`);
  }
  return hit;
};

export const clearMemoryCache = (id: string) => {
  const url = memoryCache.get(id);
  if (url) {
    memoryCache.delete(id);
  }
};
// -----------------------------

export const savePendingMedia = (id: string, blockId: string, file: File) =>
  Effect.gen(function* () {
    const entry: PendingUpload = {
      id,
      blockId,
      file,
      status: "pending",
      mimeType: file.type,
      createdAt: Date.now(),
      retryCount: 0,
      lastAttemptAt: null,
      lastError: null,
    };

    yield* Effect.tryPromise({
      try: () => set(id, entry, mediaStore),
      catch: (cause) => {
        // ✅ DEBUG: Log actual IDB error cause
        console.error(`[MediaStore] Failed to save pending upload ${id}. Cause:`, cause);
        return new MediaStorageError({ operation: "save", cause });
      },
    });

    yield* clientLog("debug", `[MediaStore] Saved pending upload: ${id}`, {
      size: file.size,
      type: file.type,
    });
  });

export const getPendingMedia = (id: string) =>
  Effect.tryPromise({
    try: async () => {
      const item = await get<PendingUpload>(id, mediaStore);
      return item || null;
    },
    catch: (cause) => new MediaStorageError({ operation: "get", cause }),
  });

export const removePendingMedia = (id: string) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => del(id, mediaStore),
      catch: (cause) => new MediaStorageError({ operation: "remove", cause }),
    });
    yield* clientLog("debug", `[MediaStore] Removed record: ${id}`);
  });

export const updateMediaStatus = (id: string, status: UploadStatus) =>
  Effect.gen(function* () {
    const item = yield* getPendingMedia(id);
    if (!item) {
      yield* clientLog(
        "warn",
        `[MediaStore] Cannot update status, item not found: ${id}`,
      );
      return;
    }
    const updated: PendingUpload = { ...item, status };
    yield* Effect.tryPromise({
      try: () => set(id, updated, mediaStore),
      catch: (cause) =>
        new MediaStorageError({ operation: "updateStatus", cause }),
    });
  });

export const incrementRetry = (id: string, errorMsg?: string) =>
  Effect.gen(function* () {
    const item = yield* getPendingMedia(id);
    if (!item) {
      yield* clientLog(
        "warn",
        `[MediaStore] Cannot increment retry, item not found: ${id}`,
      );
      return;
    }

    const updated: PendingUpload = {
      ...item,
      retryCount: item.retryCount + 1,
      lastAttemptAt: Date.now(),
      lastError: errorMsg || null,
    };

    yield* Effect.tryPromise({
      try: () => set(id, updated, mediaStore),
      catch: (cause) =>
        new MediaStorageError({ operation: "incrementRetry", cause }),
    });
  });

export const getAllPendingMedia = () =>
  Effect.gen(function* () {
    const allKeys = yield* Effect.tryPromise({
      try: () => keys(mediaStore),
      catch: (cause) => new MediaStorageError({ operation: "keys", cause }),
    });
    const items = yield* Effect.tryPromise({
      try: () => getMany<PendingUpload>(allKeys, mediaStore),
      catch: (cause) => new MediaStorageError({ operation: "getMany", cause }),
    });
    return items.filter((i): i is PendingUpload => i !== undefined);
  });
