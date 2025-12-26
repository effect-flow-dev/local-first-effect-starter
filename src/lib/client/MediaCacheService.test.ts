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
// ✅ FIX: Cast to 'any' to satisfy Bun's stricter Fetch type (missing 'preconnect')
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

// Mock ClientLog to avoid clutter and dependency issues
vi.mock("./clientLog", () => ({
  clientLog: () => Effect.void,
}));

// Mock Runtime to inject dependencies and handle async Effects
vi.mock("./runtime", async () => {
  const { Layer, ManagedRuntime } = await import("effect");
  const { ReplicacheService } = await import("./replicache");

  // Create a layer that provides the Mock Replicache Service
  const MockReplicacheLive = Layer.succeed(
    ReplicacheService,
    ReplicacheService.of({
      client: { subscribe: mockSubscribe },
    } as any),
  );

  // Use ManagedRuntime to execute effects
  const testRuntime = ManagedRuntime.make(MockReplicacheLive);

  return {
    // ✅ FIX: Use runPromise to handle the async batched workflow in the service
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
    // ✅ FIX: Wait for the effect runtime to initialize and execute the subscription
    await vi.waitUntil(() => mockSubscribe.mock.calls.length > 0);
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it("extracts URLs from index keys and fetches them", async () => {
    // 1. Start the service
    startMediaPrefetch();

    // 2. Simulate Replicache callback
    // The signature is subscribe(query, { onData: ... })
    // We wait for subscription first
    await vi.waitUntil(() => mockSubscribe.mock.calls.length > 0);
    
    const args = mockSubscribe.mock.calls[0];
    expect(args).toBeDefined();

    // ✅ FIX: Extract 'onData' from the options object (2nd argument)
    const options = args![1] as { onData: (data: unknown[]) => void };
    const onDataCallback = options.onData;

    // ✅ NEW: Mock data matches the 'imagesByUrl' index format: [SecondaryKey, PrimaryKey][]
    const mockIndexKeys = [
      ["https://r2.dev/image-1.png", "block-1"],
      ["https://r2.dev/nested-image.png", "block-2"],
    ];

    // 3. Trigger the callback logic
    onDataCallback(mockIndexKeys);

    // 4. Wait for batched processing (Service has a 10ms sleep between batches)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 5. Verification
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
    expect(args).toBeDefined();

    const options = args![1] as { onData: (data: unknown[]) => void };
    const onDataCallback = options.onData;

    // Mock keys with invalid or relative URLs which should be filtered out
    const mockKeys = [
      ["/local-asset.png", "block-3"],
      ["blob:123", "block-4"],
      [null, "block-5"],
    ];

    onDataCallback(mockKeys);

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
