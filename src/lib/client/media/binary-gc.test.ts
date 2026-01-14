// FILE: src/lib/client/media/binary-gc.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Layer, TestContext, TestClock } from "effect";
import { MediaSyncLive, MediaSyncService } from "./MediaSyncService";
import { ReplicacheService } from "../replicache";
import * as mediaStore from "./mediaStore";

// --- Mocks ---
vi.mock("./mediaStore");
vi.mock("../api", () => ({ api: { api: { media: { upload: { post: vi.fn() } } } } }));

// Mock Navigator Storage
const mockEstimate = vi.fn();
Object.defineProperty(global.navigator, "storage", {
  value: { estimate: mockEstimate },
  writable: true,
});

// Mock Replicache
const mockReplicacheClient = {
  mutate: { updateBlock: vi.fn().mockResolvedValue(true) },
  query: vi.fn().mockResolvedValue([]),
  subscribe: vi.fn(),
};

const ReplicacheMock = Layer.succeed(
  ReplicacheService,
  ReplicacheService.of({ client: mockReplicacheClient } as any),
);

// We need TestContext to control the scheduler inside MediaSyncLive
const MainTestLayer = MediaSyncLive.pipe(
  Layer.provide(ReplicacheMock),
  Layer.provide(TestContext.TestContext)
);

describe("Binary Garbage Collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEstimate.mockResolvedValue({ usage: 100, quota: 1000 }); // 10% usage (Safe)
    
    // Default: Empty store
    vi.mocked(mediaStore.getAllPendingMedia).mockReturnValue(Effect.succeed([]));
    vi.mocked(mediaStore.getExpiredMedia).mockReturnValue(Effect.succeed([]));
    vi.mocked(mediaStore.removePendingMedia).mockReturnValue(Effect.void);
  });

  it("deletes synced files older than 30 days", async () => {
    // 1. Setup Mock Data
    const expiredItem = {
      id: "old-file",
      status: "synced",
      file: { size: 1024 } as File,
      lastAccessedAt: Date.now() - (31 * 24 * 60 * 60 * 1000), // 31 days old
    };

    // Store returns this item when asked for expired media
    vi.mocked(mediaStore.getExpiredMedia).mockImplementation((threshold) => {
       // 30 days = 2592000000ms
       // threshold passed by service should be roughly that
       if (threshold > 2000000000) { 
           return Effect.succeed([expiredItem as any]);
       }
       return Effect.succeed([]);
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* MediaSyncService; // Init layer
        
        // Fast-forward 6 seconds (Past the 5s startup delay)
        yield* TestClock.adjust("6 seconds");
        yield* Effect.yieldNow();
      }).pipe(
        Effect.provide(MainTestLayer),
        Effect.scoped
      )
    );

    expect(mediaStore.getExpiredMedia).toHaveBeenCalled();
    expect(mediaStore.removePendingMedia).toHaveBeenCalledWith("old-file");
  });

  it("does NOT delete pending files even if old", async () => {
    // 1. Setup Mock Data
    // getExpiredMedia logic in mediaStore.ts handles the filtering, 
    // but here we verify the Service calls it with correct parameters 
    // and doesn't do extra deletes.
    
    vi.mocked(mediaStore.getExpiredMedia).mockReturnValue(Effect.succeed([]));

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* MediaSyncService;
        yield* TestClock.adjust("6 seconds");
        yield* Effect.yieldNow();
      }).pipe(
          Effect.provide(MainTestLayer),
          Effect.scoped
      )
    );

    expect(mediaStore.getExpiredMedia).toHaveBeenCalled();
    expect(mediaStore.removePendingMedia).not.toHaveBeenCalled();
  });

  it("triggers aggressive GC (24h retention) when storage pressure is high", async () => {
    // 1. Simulate 90% Storage Usage
    mockEstimate.mockResolvedValue({ usage: 900, quota: 1000 });

    const aggressiveItem = {
      id: "2-day-old-file",
      status: "synced",
      file: { size: 500 } as File,
      lastAccessedAt: Date.now() - (48 * 60 * 60 * 1000), // 48 hours old
    };

    vi.mocked(mediaStore.getExpiredMedia).mockImplementation((threshold) => {
        // threshold should be ~24 hours (86400000ms)
        if (threshold < 100000000) { 
            return Effect.succeed([aggressiveItem as any]);
        }
        return Effect.succeed([]);
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* MediaSyncService;
        yield* TestClock.adjust("6 seconds");
        yield* Effect.yieldNow();
      }).pipe(
          Effect.provide(MainTestLayer),
          Effect.scoped
      )
    );

    // Verify it called getExpiredMedia with a smaller threshold
    const callArgs = vi.mocked(mediaStore.getExpiredMedia).mock.calls[0];
    expect(callArgs?.[0]).toBeLessThan(30 * 24 * 60 * 60 * 1000); // Should be < 30 days
    expect(callArgs?.[0]).toBe(24 * 60 * 60 * 1000); // Should be exactly 24h

    expect(mediaStore.removePendingMedia).toHaveBeenCalledWith("2-day-old-file");
  });
});
