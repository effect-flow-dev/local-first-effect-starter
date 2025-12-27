// FILE: src/lib/server/PokeService.test.ts
import { describe, it, expect } from "vitest";
import { Effect, Stream, Fiber } from "effect";
import { subscribe, tenantSessions } from "./PokeService";
import type { UserId } from "../shared/schemas";

const USER_ID = "u1" as UserId;
const TENANT_ID = "tenant-a";

describe("PokeService (Server)", () => {
  it("registers user in tenantSessions on subscribe", async () => {
    // 1. Start subscription
    const stream = subscribe(USER_ID, TENANT_ID);
    
    // 2. Run the stream in a fiber so we can inspect state while it's "open"
    // Effect.runFork returns the fiber synchronously
    const fiber = Effect.runFork(
        Stream.runCollect(stream)
    );

    // Allow effect to tick
    await Effect.runPromise(Effect.sleep("10 millis"));

    // 3. Verify Registration
    expect(tenantSessions.has(TENANT_ID)).toBe(true);
    expect(tenantSessions.get(TENANT_ID)?.has(USER_ID)).toBe(true);

    // 4. Interrupt (simulate disconnect)
    // Use Fiber.interrupt(fiber) which returns an Effect
    await Effect.runPromise(Fiber.interrupt(fiber));

    // 5. Verify Cleanup
    expect(tenantSessions.has(TENANT_ID)).toBe(false);
  });

  it("handles multiple users in the same tenant", async () => {
    const USER_2 = "u2" as UserId;

    const fiber1 = Effect.runFork(Stream.runDrain(subscribe(USER_ID, TENANT_ID)));
    const fiber2 = Effect.runFork(Stream.runDrain(subscribe(USER_2, TENANT_ID)));

    await Effect.runPromise(Effect.sleep("10 millis"));

    const sessions = tenantSessions.get(TENANT_ID);
    expect(sessions).toBeDefined();
    expect(sessions?.size).toBe(2);
    expect(sessions?.has(USER_ID)).toBe(true);
    expect(sessions?.has(USER_2)).toBe(true);

    // Disconnect User 1
    await Effect.runPromise(Fiber.interrupt(fiber1));
    
    // Tenant should still exist with User 2
    expect(tenantSessions.has(TENANT_ID)).toBe(true);
    expect(tenantSessions.get(TENANT_ID)?.size).toBe(1);
    expect(tenantSessions.get(TENANT_ID)?.has(USER_2)).toBe(true);

    // Disconnect User 2
    await Effect.runPromise(Fiber.interrupt(fiber2));

    // Tenant map should be empty/deleted
    expect(tenantSessions.has(TENANT_ID)).toBe(false);
  });
});
