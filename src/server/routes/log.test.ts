// FILE: src/server/routes/log.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { logRoutes } from "./log";

describe("POST /api/log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully receives a client log and returns 200", async () => {
    const payload = {
      level: "info",
      message: "Hello from the browser",
      timestamp: new Date().toISOString(),
      data: { userId: "123", action: "click" },
      url: "http://localhost:3000/",
    };

    const req = new Request("http://localhost/api/log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const res = await logRoutes.handle(req);

    expect(res.status).toBe(200);
  });

  it("returns 422 if the log payload is missing required fields", async () => {
    const invalidPayload = {
      level: "info",
      // missing message
      // missing timestamp
    };

    const req = new Request("http://localhost/api/log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(invalidPayload),
    });

    const res = await logRoutes.handle(req);
    // ✅ FIX: Elysia validation errors default to 422 Unprocessable Content
    expect(res.status).toBe(422);
  });
});
