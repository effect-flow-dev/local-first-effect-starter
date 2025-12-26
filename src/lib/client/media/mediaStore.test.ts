// FILE: src/lib/client/media/mediaStore.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import * as idb from "idb-keyval";
import {
  savePendingMedia,
  getPendingMedia,
  incrementRetry, // ✅ Import
  removePendingMedia,
  MediaStorageError,
} from "./mediaStore";

// --- Mocks ---
vi.mock("idb-keyval", () => ({
  createStore: vi.fn(() => "MOCK_STORE_INSTANCE"),
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
  getMany: vi.fn(),
}));

describe("MediaStore (IndexedDB Wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("savePendingMedia correctly stores a File object with init fields", async () => {
    const mockFile = new File(["content"], "test.png", { type: "image/png" });
    const id = "test-id";
    const blockId = "test-block-id";

    vi.mocked(idb.set).mockResolvedValue(undefined);

    await Effect.runPromise(savePendingMedia(id, blockId, mockFile));

    expect(idb.set).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        id,
        blockId,
        status: "pending",
        mimeType: "image/png",
        file: mockFile,
        retryCount: 0,       // ✅ Check default
        lastAttemptAt: null, // ✅ Check default
        lastError: null,     // ✅ Check default
      }),
      "MOCK_STORE_INSTANCE",
    );
  });

  it("incrementRetry updates count and timestamp", async () => {
    const id = "test-id";
    const initialEntry = {
      id,
      retryCount: 0,
      lastAttemptAt: null,
      lastError: null,
      file: new File([""], "f"),
    };

    // Mock retrieving the item
    vi.mocked(idb.get).mockResolvedValue(initialEntry);
    vi.mocked(idb.set).mockResolvedValue(undefined);

    const startTime = Date.now();
    await Effect.runPromise(incrementRetry(id, "Network Error"));

    // Check set call
    const setCall = vi.mocked(idb.set).mock.calls[0];
    const savedItem = setCall?.[1] as any;

    expect(savedItem.retryCount).toBe(1);
    expect(savedItem.lastError).toBe("Network Error");
    expect(savedItem.lastAttemptAt).toBeGreaterThanOrEqual(startTime);
  });

  it("getPendingMedia returns the file object given a valid ID", async () => {
    const id = "test-id";
    const mockEntry = {
      id,
      status: "pending",
      file: new File(["data"], "test.png"),
    };

    vi.mocked(idb.get).mockResolvedValue(mockEntry);

    const result = await Effect.runPromise(getPendingMedia(id));

    expect(result).toEqual(mockEntry);
    expect(idb.get).toHaveBeenCalledWith(id, "MOCK_STORE_INSTANCE");
  });

  it("removePendingMedia successfully deletes the entry", async () => {
    const id = "test-id";
    vi.mocked(idb.del).mockResolvedValue(undefined);

    await Effect.runPromise(removePendingMedia(id));

    expect(idb.del).toHaveBeenCalledWith(id, "MOCK_STORE_INSTANCE");
  });

  it("returns a typed MediaStorageError on IndexedDB failure", async () => {
    const id = "test-id";
    const dbError = new Error("QuotaExceeded");
    vi.mocked(idb.get).mockRejectedValue(dbError);

    const result = await Effect.runPromise(
      Effect.either(getPendingMedia(id))
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(MediaStorageError);
      expect(result.left.cause).toBe(dbError);
      expect(result.left.operation).toBe("get");
    }
  });
});
