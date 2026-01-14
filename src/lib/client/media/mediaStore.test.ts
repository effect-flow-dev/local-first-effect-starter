// FILE: src/lib/client/media/mediaStore.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import * as idb from "idb-keyval";
import {
  savePendingMedia,
  getPendingMedia,
  incrementRetry,
  touchMedia,
  getExpiredMedia,
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
    vi.useFakeTimers();
  });

  it("savePendingMedia correctly stores a File object with init fields including lastAccessedAt", async () => {
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
        retryCount: 0,
        lastAttemptAt: null,
        lastError: null,
        lastAccessedAt: expect.any(Number) // ✅ Check
      }),
      "MOCK_STORE_INSTANCE",
    );
  });

  it("touchMedia updates lastAccessedAt", async () => {
    const id = "test-touch";
    const oldTime = Date.now() - 100000; // Old enough to update
    const entry = { id, lastAccessedAt: oldTime };

    vi.mocked(idb.get).mockResolvedValue(entry);
    vi.mocked(idb.set).mockResolvedValue(undefined);

    await Effect.runPromise(touchMedia(id));

    const setCall = vi.mocked(idb.set).mock.calls[0];
    const saved = setCall?.[1] as any;
    expect(saved.lastAccessedAt).toBeGreaterThan(oldTime);
  });

  it("touchMedia debounces writes for recent access", async () => {
    const id = "test-touch-debounce";
    const recentTime = Date.now() - 1000; // Only 1s ago
    const entry = { id, lastAccessedAt: recentTime };

    vi.mocked(idb.get).mockResolvedValue(entry);

    await Effect.runPromise(touchMedia(id));

    expect(idb.set).not.toHaveBeenCalled();
  });

  it("getExpiredMedia returns only synced and old items", async () => {
    const now = Date.now();
    const threshold = 10000; // 10s

    const items = [
        { id: "1", status: "synced", lastAccessedAt: now - 20000 }, // Expired
        { id: "2", status: "synced", lastAccessedAt: now - 5000 },  // Valid
        { id: "3", status: "pending", lastAccessedAt: now - 20000 }, // Pending (Keep)
        { id: "4", status: "uploaded", lastAccessedAt: now - 20000 }, // Uploaded (Keep/Transitioning)
    ];

    vi.mocked(idb.keys).mockResolvedValue(items.map(i => i.id));
    vi.mocked(idb.getMany).mockResolvedValue(items);

    const expired = await Effect.runPromise(getExpiredMedia(threshold));

    expect(expired).toHaveLength(1);
    expect(expired[0]!.id).toBe("1");
  });

  it("incrementRetry updates count and timestamp", async () => {
    const id = "test-id";
    const initialEntry = {
      id,
      retryCount: 0,
      lastAttemptAt: null,
      lastError: null,
      file: new File([""], "f"),
      lastAccessedAt: Date.now()
    };

    vi.mocked(idb.get).mockResolvedValue(initialEntry);
    vi.mocked(idb.set).mockResolvedValue(undefined);

    const startTime = Date.now();
    await Effect.runPromise(incrementRetry(id, "Network Error"));

    const setCall = vi.mocked(idb.set).mock.calls[0];
    const savedItem = setCall?.[1] as any;

    expect(savedItem.retryCount).toBe(1);
    expect(savedItem.lastError).toBe("Network Error");
    expect(savedItem.lastAttemptAt).toBeGreaterThanOrEqual(startTime);
  });

  it("getPendingMedia lazily migrates old records without lastAccessedAt", async () => {
    const id = "legacy-id";
    const legacyEntry = { id, status: "pending" }; // No lastAccessedAt

    vi.mocked(idb.get).mockResolvedValue(legacyEntry);

    const result = await Effect.runPromise(getPendingMedia(id));

    expect(result).toMatchObject({
        id: "legacy-id",
        status: "pending",
        lastAccessedAt: expect.any(Number)
    });
  });
});
