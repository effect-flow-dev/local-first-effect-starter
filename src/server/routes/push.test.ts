// FILE: src/server/routes/push.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { pushRoutes } from "./push";
import type { UserId } from "../../lib/shared/schemas";

// --- Mocks ---
const { mockDb, mockInsertInto, mockContextState } = vi.hoisted(() => {
  // ✅ FIX: Initialize mockExecute to return a resolved Promise (void)
  // This satisfies the await/then expectation of Effect.tryPromise
  const mockExecute = vi.fn().mockResolvedValue(undefined);
  const mockInsertInto = vi.fn().mockReturnThis();
  
  const mockQueryBuilder = {
    values: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    column: vi.fn().mockReturnThis(),
    doUpdateSet: vi.fn().mockReturnThis(),
    execute: mockExecute,
  };

  mockInsertInto.mockReturnValue(mockQueryBuilder);

  return { 
    mockDb: { insertInto: mockInsertInto },
    mockInsertInto,
    // Mutable container for context state to control tests dynamically
    mockContextState: {
        user: null as any,
        userDb: null as any,
        tenant: null as any,
        currentRole: null as any
    }
  };
});

// Mock user context to bypass auth/tenant resolution logic entirely.
// This ensures we test the route's logic, not the middleware.
vi.mock("../context", () => ({
  userContext: (app: any) => app.derive(() => mockContextState)
}));

// We still need to mock db/client if the route imports it directly
vi.mock("../../db/client", () => ({
  getUserDb: () => mockDb,
  centralDb: {} as any,
}));

describe("POST /api/push/subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default State: Authenticated with valid DB
    mockContextState.user = { id: "u1" as UserId, subdomain: "test" };
    mockContextState.userDb = mockDb;
    mockContextState.tenant = { id: "t1" };
    mockContextState.currentRole = "OWNER";
  });

  it("should validate input and save subscription", async () => {
    const payload = {
      endpoint: "https://push.example.com",
      keys: {
        p256dh: "key123",
        auth: "auth123",
      },
    };

    // ✅ FIX: Update URL to match route definition (/subscription)
    const req = new Request("http://localhost/api/push/subscription", {
      method: "POST",
      headers: { 
          "Content-Type": "application/json",
          // Auth header is technically ignored by our mockContext, but good for docs
          "Authorization": "Bearer token" 
      },
      body: JSON.stringify(payload),
    });

    const res = await pushRoutes.handle(req);
    
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    expect(mockInsertInto).toHaveBeenCalledWith("push_subscription");
  });

  it("should return 401 if not authenticated (user missing)", async () => {
    // Set context to Unauthenticated
    mockContextState.user = null;
    mockContextState.userDb = null;

    const payload = {
        endpoint: "https://push.example.com",
        keys: { p256dh: "k", auth: "a" }
    };

    // ✅ FIX: Update URL to match route definition (/subscription)
    const req = new Request("http://localhost/api/push/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await pushRoutes.handle(req);
    
    expect(res.status).toBe(401);
  });
});
