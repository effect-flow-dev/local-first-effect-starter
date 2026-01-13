// FILE: src/lib/client/MediaCacheService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startMediaPrefetch } from "./MediaCacheService";
import { Effect } from "effect";

// --- Mocks ---
const { mockSubscribe } = vi.hoisted(() => ({
  mockSubscribe: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock Replicache Service
vi.mock("./replicache", async () => {
  const { Context } = await import("effect");
  class ReplicacheService extends Context.Tag("ReplicacheService")<
    ReplicacheService,
    { client: { subscribe: any } }
  >() {}
  return { ReplicacheService };
});

// Mock ClientLog
vi.mock("./clientLog", () => ({
  clientLog: () => Effect.void,
}));

// Mock Runtime
vi.mock("./runtime", async () => {
  const { Layer, ManagedRuntime } = await import("effect");
  const { ReplicacheService } = await import("./replicache");

  const MockReplicacheLive = Layer.succeed(
    ReplicacheService,
    ReplicacheService.of({
      client: { subscribe: mockSubscribe },
    } as any),
  );

  const testRuntime = ManagedRuntime.make(MockReplicacheLive);

  return {
    runClientUnscoped: (effect: any) => testRuntime.runPromise(effect),
  };
});

describe("MediaCacheService (Prefetcher)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("subscribes to Replicache on start", async () => {
    startMediaPrefetch();
    await vi.waitUntil(() => mockSubscribe.mock.calls.length > 0);
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it("extracts URLs from blocks and fetches them", async () => {
    startMediaPrefetch();
    await vi.waitUntil(() => mockSubscribe.mock.calls.length > 0);
    
    const args = mockSubscribe.mock.calls[0];
    const options = args![1] as { onData: (data: unknown[]) => void };
    const onDataCallback = options.onData;

    // ✅ FIX: Provide full block objects matching BlockWithUrl interface
    // The service now scans values(), not keys()
    const mockBlocks = [
      {
        id: "block-1",
        type: "image",
        fields: { url: "https://r2.dev/image-1.png" }
      },
      {
        id: "block-2",
        type: "image",
        fields: { url: "https://r2.dev/nested-image.png" }
      },
    ];

    onDataCallback(mockBlocks);

    // Wait for batched processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://r2.dev/image-1.png",
      expect.objectContaining({ mode: "no-cors" }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://r2.dev/nested-image.png",
      expect.objectContaining({ mode: "no-cors" }),
    );
  });

  it("ignores non-http URLs", async () => {
    startMediaPrefetch();
    await vi.waitUntil(() => mockSubscribe.mock.calls.length > 0);
    
    const args = mockSubscribe.mock.calls[0];
    const options = args![1] as { onData: (data: unknown[]) => void };
    const onDataCallback = options.onData;

    // Mock blocks with invalid URLs
    const mockBlocks = [
      { id: "b3", type: "image", fields: { url: "/local.png" } },
      { id: "b4", type: "image", fields: { url: "blob:123" } },
      { id: "b5", type: "image", fields: { url: null } },
    ];

    onDataCallback(mockBlocks);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
