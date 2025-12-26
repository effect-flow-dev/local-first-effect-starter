// FILE: src/server/routes/media.test.ts
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { mediaRoutes } from "./media";
import { Effect } from "effect";
import type { UserId } from "../../lib/shared/schemas";

// --- Mocks ---
const mocks = vi.hoisted(() => ({
  uploadMedia: vi.fn(),
  validateToken: vi.fn(),
  getUserDb: vi.fn(),
}));

vi.mock("../../lib/server/s3", () => ({
  uploadMedia: mocks.uploadMedia,
}));

vi.mock("../../lib/server/JwtService", () => ({
  validateToken: mocks.validateToken,
}));

vi.mock("../../db/client", () => ({
  getUserDb: mocks.getUserDb,
  centralDb: {} as any, 
}));

// Mock Data
const validUser = {
  id: "user-123" as UserId,
  subdomain: "test-user",
  tenant_strategy: "schema",
  database_name: null,
};

describe("POST /api/media/upload", () => {
  beforeAll(() => {
    // Polyfill for File.prototype.stream for JSDOM
    if (typeof File !== "undefined" && !File.prototype.stream) {
      File.prototype.stream = function () {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const file = this;
        return new ReadableStream({
          start(controller) {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result;
              if (result instanceof ArrayBuffer) {
                controller.enqueue(new Uint8Array(result));
                controller.close();
              } else {
                controller.error(new Error("FileReader result was not an ArrayBuffer"));
              }
            };
            reader.onerror = () => controller.error(reader.error);
            reader.readAsArrayBuffer(file);
          }
        });
      };
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateToken.mockReturnValue(Effect.succeed(validUser));
    mocks.getUserDb.mockReturnValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Success: Returns 200 OK and Public URL for valid image", async () => {
    const imageFile = new File(["(image data)"], "photo.jpg", { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("file", imageFile);

    mocks.uploadMedia.mockReturnValue(Effect.succeed("https://cdn.example.com/photo.jpg"));

    const req = new Request("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });
    
    // Add auth header afterwards
    req.headers.set("Authorization", "Bearer valid-token");

    // ✅ FIX: Safe header logging using forEach
    const debugHeaders: Record<string, string> = {};
    req.headers.forEach((v, k) => { debugHeaders[k] = v; });
    console.log("[TEST DEBUG] Request Headers:", debugHeaders);

    const res = await mediaRoutes.handle(req);
    
    if (res.status !== 200) {
        console.log("[TEST DEBUG] Failed Response Status:", res.status);
        console.log("[TEST DEBUG] Failed Response Body:", await res.clone().text());
    }
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ url: "https://cdn.example.com/photo.jpg" });
  });

  it("Success: Returns 200 OK for GIF image", async () => {
    // ✅ NEW TEST CASE: GIF Support
    const gifFile = new File(["GIF89a..."], "funny.gif", { type: "image/gif" });
    const formData = new FormData();
    formData.append("file", gifFile);

    mocks.uploadMedia.mockReturnValue(Effect.succeed("https://cdn.example.com/funny.gif"));

    const req = new Request("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });
    
    req.headers.set("Authorization", "Bearer valid-token");

    const res = await mediaRoutes.handle(req);
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ url: "https://cdn.example.com/funny.gif" });
  });

  it("Auth Check: Returns 401 Unauthorized if no token provided", async () => {
    const formData = new FormData();
    formData.append("file", new File(["a"], "a.png", { type: "image/png" }));

    const req = new Request("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });

    const res = await mediaRoutes.handle(req);
    expect(res.status).toBe(401);
  });

  it("Validation: Returns 400 Bad Request if file is missing", async () => {
    const formData = new FormData();
    // Empty form data

    const req = new Request("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });
    req.headers.set("Authorization", "Bearer valid-token");

    const res = await mediaRoutes.handle(req);
    expect(res.status).toBe(400); 
  });

  it("Validation: Returns 413 Payload Too Large if file > 10MB", async () => {
    const largeBuffer = new Uint8Array(10 * 1024 * 1024 + 1);
    const fakeFile = new File([largeBuffer], "large.png", { type: "image/png" });

    const formData = new FormData();
    formData.append("file", fakeFile);

    const req = new Request("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });
    req.headers.set("Authorization", "Bearer valid-token");

    const res = await mediaRoutes.handle(req);
    expect(res.status).toBe(413);
  });

  it("Validation: Returns 415 Unsupported Media Type for non-image", async () => {
    const pdfFile = new File(["%PDF-1.5"], "doc.pdf", { type: "application/pdf" });
    const formData = new FormData();
    formData.append("file", pdfFile);

    const req = new Request("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });
    req.headers.set("Authorization", "Bearer valid-token");

    const res = await mediaRoutes.handle(req);
    expect(res.status).toBe(415);
  });
});
