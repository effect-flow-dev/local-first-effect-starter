// FILE: src/lib/client/stores/noteListStore.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { noteListState, startNoteListSubscription, stopNoteListSubscription } from "./noteListStore";

// 1. Hoist spies
const { mockSubscribe } = vi.hoisted(() => ({
  mockSubscribe: vi.fn(),
}));

// 2. Mock Replicache FIRST to break circular dependency
vi.mock("../replicache", async () => {
  const { Context } = await import("effect");
  class ReplicacheService extends Context.Tag("ReplicacheService")<
    ReplicacheService,
    { client: { subscribe: any } }
  >() {}
  return { ReplicacheService };
});

// 3. Mock Runtime
vi.mock("../runtime", async (importOriginal) => {
  const original = await importOriginal<typeof import("../runtime")>();
  const { Effect, Layer, Scope } = await import("effect");
  const { ReplicacheService } = await import("../replicache");

  const MockReplicacheLive = Layer.succeed(
    ReplicacheService,
    ReplicacheService.of({ 
      client: { subscribe: mockSubscribe } 
    } as any),
  );

  const testScope = Effect.runSync(Scope.make());
  Effect.runSync(
    Scope.extend(Layer.toRuntime(MockReplicacheLive), testScope),
  );

  return {
    ...original,
    runClientUnscoped: (effect: any) =>
      original.runClientUnscoped(effect.pipe(Effect.provide(MockReplicacheLive))),
  };
});

describe("noteListStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noteListState.value = [];
  });

  // Updated tests to reflect manual control API used by lifecycle.ts
  it("should subscribe when started manually", async () => {
    startNoteListSubscription();
    
    // Allow microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSubscribe).toHaveBeenCalled();
  });

  it("should unsubscribe when stopped manually", async () => {
    const mockUnsubscribe = vi.fn();
    mockSubscribe.mockReturnValue(mockUnsubscribe);

    startNoteListSubscription();
    await new Promise((r) => setTimeout(r, 0));
    
    stopNoteListSubscription();
    
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(noteListState.value).toEqual([]);
  });
});
