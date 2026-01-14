// FILE: src/lib/client/media/MediaSyncService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Layer, TestContext, TestClock } from "effect";
import { MediaSyncLive, MediaSyncService } from "./MediaSyncService";
import { ReplicacheService } from "../replicache";
import * as mediaStore from "./mediaStore";
import { api } from "../api";

// --- Mocks ---
vi.mock("./mediaStore");

vi.mock("../api", () => ({
  api: {
    api: {
      media: {
        upload: {
          post: vi.fn(),
        },
      },
    },
  },
}));

const mockReplicacheMutate = {
  updateBlock: vi.fn().mockResolvedValue(true),
};

const mockReplicacheClient = {
  mutate: mockReplicacheMutate,
  query: vi.fn().mockResolvedValue([]),
  subscribe: vi.fn(), // Mock subscribe as it is used in MediaSyncLive init
};

const ReplicacheMock = Layer.succeed(
  ReplicacheService,
  ReplicacheService.of({
    client: mockReplicacheClient,
  } as any),
);

// We construct the test layer such that MediaSyncLive receives the TestContext (Clock/Scheduler)
// Order matters: TestContext -> Replicache -> MediaSync
const MainTestLayer = MediaSyncLive.pipe(
  Layer.provide(ReplicacheMock),
  Layer.provide(TestContext.TestContext) 
);

describe("MediaSyncService Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("jwt", "mock-token");

    // Default API Success
    vi.mocked(api.api.media.upload.post).mockResolvedValue({
      data: { url: "http://ok.com" },
      error: null,
      status: 200,
    } as any);

    // Default Replicache Success
    mockReplicacheMutate.updateBlock.mockResolvedValue(true);
    mockReplicacheClient.query.mockResolvedValue([]);

    // Default Store Mocks
    vi.mocked(mediaStore.getAllPendingMedia).mockReturnValue(Effect.succeed([]));
    vi.mocked(mediaStore.getPendingMedia).mockReturnValue(Effect.succeed(null));
    vi.mocked(mediaStore.removePendingMedia).mockReturnValue(Effect.void);
    vi.mocked(mediaStore.updateMediaStatus).mockReturnValue(Effect.void);
    vi.mocked(mediaStore.incrementRetry).mockReturnValue(Effect.void);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("Test 1 (Persistence): Item remains in IDB on transient failure (500)", async () => {
    const uploadId = "upload-persist";

    // 1. Setup IDB State
    vi.mocked(mediaStore.getPendingMedia).mockReturnValue(
      Effect.succeed({
        id: uploadId,
        blockId: "b1",
        file: new File([""], "f.png"),
        status: "pending",
        mimeType: "image/png",
        createdAt: Date.now(),
        retryCount: 0,
        lastAttemptAt: null,
        lastError: null,
        lastAccessedAt: Date.now(),
      }),
    );

    // 2. Mock API Failure (Transient)
    vi.mocked(api.api.media.upload.post).mockResolvedValue({
      data: null,
      error: { value: { error: "Server Boom" } },
      status: 500,
    } as any);

    // 3. Run Test Effect
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* MediaSyncService;
        
        // Queue the upload
        yield* service.queueUpload(uploadId);
        
        // Yield to allow the background queue fiber to pick up the item
        yield* Effect.yieldNow();

        // Advance time past the 1500ms sleep in 'processUpload'
        yield* TestClock.adjust("2 seconds");
        
        // Yield again to let the service execute the logic after waking up
        yield* Effect.yieldNow();
      }).pipe(
        Effect.provide(MainTestLayer),
        Effect.scoped // Manages the forkDaemon lifecycles
      )
    );

    // 4. Assertions
    expect(mediaStore.updateMediaStatus).toHaveBeenCalledWith(uploadId, "uploading");
    expect(mediaStore.updateMediaStatus).not.toHaveBeenCalledWith(uploadId, "error");
    // Should NOT remove because it failed transiently
    expect(mediaStore.removePendingMedia).not.toHaveBeenCalled();
    expect(mediaStore.incrementRetry).toHaveBeenCalled();
  });

  it("Test 2 (Resume): Picks up pending uploads from IDB on initialization, ignoring 'synced'", async () => {
    const pendingId = "upload-resume";
    const syncedId = "upload-done";

    // 1. Setup IDB with mixed items
    vi.mocked(mediaStore.getAllPendingMedia).mockReturnValue(
      Effect.succeed([
        {
          id: pendingId,
          blockId: "b1",
          file: new File([""], "resume.png"),
          status: "pending",
          mimeType: "image/png",
          createdAt: Date.now(),
          retryCount: 0,
          lastAttemptAt: null,
          lastError: null,
          lastAccessedAt: Date.now(),
        },
        {
          id: syncedId,
          blockId: "b2",
          file: new File([""], "done.png"),
          status: "synced", // ✅ Should be ignored
          mimeType: "image/png",
          createdAt: Date.now(),
          retryCount: 0,
          lastAttemptAt: null,
          lastError: null,
          lastAccessedAt: Date.now(),
        }
      ]),
    );

    // Setup retrieval for the processing step
    vi.mocked(mediaStore.getPendingMedia).mockImplementation((id) => {
        if (id === pendingId) {
            return Effect.succeed({
                id: pendingId,
                blockId: "b1",
                file: new File([""], "resume.png"),
                status: "pending",
                mimeType: "image/png",
                createdAt: Date.now(),
                retryCount: 0,
                lastAttemptAt: null,
                lastError: null,
                lastAccessedAt: Date.now(),
            });
        }
        return Effect.succeed(null);
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* MediaSyncService;
        yield* Effect.yieldNow();
        yield* TestClock.adjust("2 seconds");
        yield* Effect.yieldNow();
      }).pipe(
        Effect.provide(MainTestLayer),
        Effect.scoped
      )
    );

    // 3. Assertions
    expect(mediaStore.getAllPendingMedia).toHaveBeenCalled();
    // Should only attempt to get/process the 'pending' item
    expect(mediaStore.getPendingMedia).toHaveBeenCalledWith(pendingId);
    expect(mediaStore.getPendingMedia).not.toHaveBeenCalledWith(syncedId);
    expect(api.api.media.upload.post).toHaveBeenCalledTimes(1);
    
    // ✅ MODIFIED EXPECTATION: Should mark as synced, NOT remove
    expect(mediaStore.updateMediaStatus).toHaveBeenCalledWith(pendingId, "synced");
    expect(mediaStore.removePendingMedia).not.toHaveBeenCalled();
  });

  it("Test 3 (Fatal Stop): 413 error marks item as Error and stops retrying", async () => {
    const uploadId = "upload-fatal";

    // 1. Setup IDB
    vi.mocked(mediaStore.getPendingMedia).mockReturnValue(
      Effect.succeed({
        id: uploadId,
        blockId: "b1",
        file: new File([""], "large.png"),
        status: "pending",
        mimeType: "image/png",
        createdAt: Date.now(),
        retryCount: 0,
        lastAttemptAt: null,
        lastError: null,
        lastAccessedAt: Date.now(),
      }),
    );

    // 2. Mock 413 Fatal Error
    vi.mocked(api.api.media.upload.post).mockResolvedValue({
      data: null,
      error: { value: { error: "Payload Too Large" } },
      status: 413,
    } as any);

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* MediaSyncService;
        yield* service.queueUpload(uploadId);
        
        yield* Effect.yieldNow();
        yield* TestClock.adjust("2 seconds");
        yield* Effect.yieldNow();
      }).pipe(
        Effect.provide(MainTestLayer),
        Effect.scoped
      )
    );

    // 4. Assertions
    expect(mediaStore.updateMediaStatus).toHaveBeenCalledWith(uploadId, "error");
    expect(mediaStore.incrementRetry).not.toHaveBeenCalled();
    expect(mediaStore.removePendingMedia).not.toHaveBeenCalled();
  });
});
