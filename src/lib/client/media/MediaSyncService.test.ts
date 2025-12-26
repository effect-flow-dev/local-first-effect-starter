// FILE: src/lib/client/media/MediaSyncService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Layer } from "effect";
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
};

const ReplicacheMock = Layer.succeed(
  ReplicacheService,
  ReplicacheService.of({
    client: mockReplicacheClient,
  } as any),
);

// Helper to run the service layer
const runTestLayer = <A>(effect: Effect.Effect<A, any, MediaSyncService>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(MediaSyncLive),
      Effect.provide(ReplicacheMock),
      Effect.scoped,
    ) as Effect.Effect<A, any, never>
  );

describe("MediaSyncService Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ✅ FIX: Mock LocalStorage JWT so the service doesn't fail with "No JWT" before attempting upload
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
        status: "pending", // Initial state
        mimeType: "image/png",
        createdAt: Date.now(),
        retryCount: 0,
        lastAttemptAt: null,
        lastError: null
      }),
    );

    // 2. Mock API Failure (Transient)
    vi.mocked(api.api.media.upload.post).mockResolvedValue({
      data: null,
      error: { value: { error: "Server Boom" } },
      status: 500,
    } as any);

    // 3. Queue Upload
    await runTestLayer(
      Effect.gen(function* () {
        const service = yield* MediaSyncService;
        yield* service.queueUpload(uploadId);
        // Allow event loop to process initial attempt
        yield* Effect.sleep("20 millis");
      }),
    );

    // 4. Assertions
    // Should mark as uploading initially
    expect(mediaStore.updateMediaStatus).toHaveBeenCalledWith(uploadId, "uploading");
    
    // Should NOT be marked as fatal error
    expect(mediaStore.updateMediaStatus).not.toHaveBeenCalledWith(uploadId, "error");
    
    // CRITICAL: Should NOT be removed from IDB (Data Safety)
    expect(mediaStore.removePendingMedia).not.toHaveBeenCalled();
    
    // Should have attempted retry logic (incrementing counters)
    // Note: The schedule runs incrementRetry *before* the delay
    expect(mediaStore.incrementRetry).toHaveBeenCalled();
  });

  it("Test 2 (Resume): Picks up pending uploads from IDB on initialization", async () => {
    const pendingId = "upload-resume";
    
    // 1. Setup IDB with existing pending item
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
          lastError: null
        }
      ]),
    );

    // Setup retrieval for the processing step
    vi.mocked(mediaStore.getPendingMedia).mockReturnValue(
      Effect.succeed({
        id: pendingId,
        blockId: "b1",
        file: new File([""], "resume.png"),
        status: "pending",
        mimeType: "image/png",
        createdAt: Date.now(),
        retryCount: 0,
        lastAttemptAt: null,
        lastError: null
      })
    );

    // 2. Initialize Service (Simulate App Start)
    await runTestLayer(
      Effect.gen(function* () {
        // Just accessing the service triggers the Layer effect (init logic)
        yield* MediaSyncService;
        // Wait for resume logic to enqueue and process
        yield* Effect.sleep("20 millis");
      }),
    );

    // 3. Assertions
    // Should have scanned IDB
    expect(mediaStore.getAllPendingMedia).toHaveBeenCalled();
    
    // Should have started processing the item
    expect(mediaStore.getPendingMedia).toHaveBeenCalledWith(pendingId);
    expect(api.api.media.upload.post).toHaveBeenCalled();
    
    // Should succeed and clean up
    expect(mediaStore.removePendingMedia).toHaveBeenCalledWith(pendingId);
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
        lastError: null
      }),
    );

    // 2. Mock 413 Fatal Error
    vi.mocked(api.api.media.upload.post).mockResolvedValue({
      data: null,
      error: { value: { error: "Payload Too Large" } },
      status: 413,
    } as any);

    // 3. Queue Upload
    await runTestLayer(
      Effect.gen(function* () {
        const service = yield* MediaSyncService;
        yield* service.queueUpload(uploadId);
        yield* Effect.sleep("20 millis");
      }),
    );

    // 4. Assertions
    // Should update status to 'error' to notify UI
    expect(mediaStore.updateMediaStatus).toHaveBeenCalledWith(uploadId, "error");
    
    // Should NOT increment retry (Schedule.while predicate fails for FatalUploadError)
    expect(mediaStore.incrementRetry).not.toHaveBeenCalled();
    
    // Should NOT remove from IDB (allows user to see error/delete manually)
    expect(mediaStore.removePendingMedia).not.toHaveBeenCalled();
  });
});
