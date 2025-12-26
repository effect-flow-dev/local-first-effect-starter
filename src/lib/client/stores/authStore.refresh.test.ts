// FILE: src/lib/client/stores/authStore.refresh.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { authState, proposeAuthAction, initializeAuthStore } from "./authStore";
import type { PublicUser } from "../../shared/schemas";

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock("../router", () => ({
  navigate: mockNavigate,
}));

vi.mock("../runtime", async (importOriginal) => {
  const original = await importOriginal<typeof import("../runtime")>();
  return {
    ...original,
    runClientUnscoped: (effect: any) => Effect.runFork(effect),
  };
});

describe("authStore (Refresh Behavior)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockNavigate.mockReturnValue(Effect.void);
    
    // ✅ FIX: Update initial state to include tenant/role context
    authState.value = { 
        status: "initializing", 
        user: null,
        currentTenant: null,
        currentRole: null
    };
    initializeAuthStore();
  });

  it("should NOT navigate to '/' when SET_AUTHENTICATED is called (preserving current URL)", async () => {
    const mockUser: PublicUser = {
      id: "u1" as any,
      email: "test@example.com",
      email_verified: true,
      created_at: new Date(),
      avatar_url: null,
      permissions: [],
      tenant_strategy: "schema",
      database_name: null,
      subdomain: "test-user",
    };

    // ✅ FIX: Wrap user in payload object { user: ... }
    await proposeAuthAction({ 
        type: "SET_AUTHENTICATED", 
        payload: { user: mockUser } 
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(authState.value.status).toBe("authenticated");
    expect(authState.value.user).toEqual(mockUser);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("should navigate to '/login' when LOGOUT_SUCCESS occurs", async () => {
    await proposeAuthAction({ type: "LOGOUT_SUCCESS" });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });
});
