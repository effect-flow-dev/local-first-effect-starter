// FILE: src/lib/client/stores/presenceStore.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { presenceState, updatePresence, cleanupPresence } from "./presenceStore";

describe("presenceStore", () => {
  beforeEach(() => {
    // Reset state and timers
    presenceState.value = {};
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a user to a block with generated color", () => {
    updatePresence("block-1", "user-1");
    
    const users = presenceState.value["block-1"];
    expect(users).toHaveLength(1);
    expect(users![0]!.userId).toBe("user-1");
    // Ensure hex color format
    expect(users![0]!.color).toMatch(/^#[0-9A-F]{6}$/); 
  });

  it("updates existing user timestamp without creating duplicates", () => {
    updatePresence("block-1", "user-1");
    const firstTime = presenceState.value["block-1"]![0]!.lastActive;

    // Advance time by 1s
    vi.advanceTimersByTime(1000);
    
    updatePresence("block-1", "user-1");
    const users = presenceState.value["block-1"];
    
    expect(users).toHaveLength(1);
    expect(users![0]!.lastActive).toBeGreaterThan(firstTime);
  });

  it("handles multiple users on the same block", () => {
    updatePresence("block-1", "user-1");
    updatePresence("block-1", "user-2");

    const users = presenceState.value["block-1"];
    expect(users).toHaveLength(2);
    expect(users!.find(u => u.userId === "user-1")).toBeDefined();
    expect(users!.find(u => u.userId === "user-2")).toBeDefined();
  });

  it("removes stale users after timeout (30s)", () => {
    updatePresence("block-1", "user-1");
    
    // Advance 5 seconds
    vi.advanceTimersByTime(5000);
    
    // Manually trigger cleanup to ensure it runs with the fake time
    cleanupPresence();
    
    // Should remain active (only 5s passed)
    expect(presenceState.value["block-1"]).toHaveLength(1);

    // Advance 26 seconds more (Total 31s)
    vi.advanceTimersByTime(26000); 
    
    // Manually trigger cleanup
    cleanupPresence();
    
    // The interval logic inside checks (now - lastActive > 30000).
    // 31000 > 30000, so it should remove the user.
    expect(presenceState.value["block-1"]).toBeUndefined();
  });
});
