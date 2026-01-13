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

const validUser = {
  id: "user-123" as UserId,
  email: "media-test@test.com",
  email_verified: true,
  created_at: new Date(),
  avatar_url: null,
  permissions: [],
};

const mockContextState = {
    user: validUser,
    userDb: {} as any,
    tenant: null,
    requestedSubdomain: null,
    currentRole: "OWNER",
    isPlatformAdmin: false
};

vi.mock("../context", () => ({
  userContext: (app: any) => app.derive(() => mockContextState),
  getRequestedSubdomain: vi.fn()
}));

vi.mock("../../db/client", () => ({
  getUserDb: mocks.getUserDb,
  centralDb: {} as any, 
}));

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
    mockContextState.user = validUser;
    mocks.validateToken.mockReturnValue(Effect.succeed(validUser));
    mocks.getUserDb.mockReturnValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Success: Returns 200 OK and Public URL for valid image", async () => {
    const imageFile = new File(["(image data)"], "photo.jpg", { type: "image/jpeg" });
    
    // Manual Request Mock to inject FormData method
    const req = new Request("http://localhost/api/media/upload", { method: "POST" });
    req.headers.set("Authorization", "Bearer valid-token");

    vi.spyOn(req, "formData").mockResolvedValue({
        get: (key: string) => key === "file" ? imageFile : null
    } as any);

    mocks.uploadMedia.mockReturnValue(Effect.succeed("https://cdn.example.com/photo.jpg"));

    const res = await mediaRoutes.handle(req);
    
    expect(res.status).toBe(200);
    const json = await res.json();
    
    expect(json).toEqual({ 
        url: "https://cdn.example.com/photo.jpg",
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: imageFile.size
    });
  });

  it("Success: Returns 200 OK for GIF image", async () => {
    const gifFile = new File(["GIF89a..."], "funny.gif", { type: "image/gif" });
    
    const req = new Request("http://localhost/api/media/upload", { method: "POST" });
    req.headers.set("Authorization", "Bearer valid-token");

    vi.spyOn(req, "formData").mockResolvedValue({
        get: (key: string) => key === "file" ? gifFile : null
    } as any);

    mocks.uploadMedia.mockReturnValue(Effect.succeed("https://cdn.example.com/funny.gif"));

    const res = await mediaRoutes.handle(req);
    
    expect(res.status).toBe(200);
    const json = await res.json();
    
    expect(json).toEqual({ 
        url: "https://cdn.example.com/funny.gif",
        filename: "funny.gif",
        mimeType: "image/gif",
        size: gifFile.size
    });
  });

  it("Auth Check: Returns 401 Unauthorized if no user in context", async () => {
    mockContextState.user = null as any;

    const req = new Request("http://localhost/api/media/upload", { method: "POST" });
    // Mock body not strictly necessary for this auth check, but keeping it valid
    vi.spyOn(req, "formData").mockResolvedValue({
        get: () => new File(["a"], "a.png", { type: "image/png" })
    } as any);

    const res = await mediaRoutes.handle(req);
    expect(res.status).toBe(401);
  });

  it("Validation: Returns 400 Bad Request if file is missing", async () => {
    const req = new Request("http://localhost/api/media/upload", { method: "POST" });
    req.headers.set("Authorization", "Bearer valid-token");

    vi.spyOn(req, "formData").mockResolvedValue({
        get: () => null // Empty
    } as any);

    const res = await mediaRoutes.handle(req);
    expect(res.status).toBe(400); 
  });

  it("Validation: Returns 413 Payload Too Large if file > 50MB", async () => {
    const largeSize = (50 * 1024 * 1024) + 10;
    
    // Mock a large file
    const largeMockFile = {
        name: "large.png",
        type: "image/png",
        size: largeSize,
        stream: () => new ReadableStream(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
    };

    const req = new Request("http://localhost/api/media/upload", { method: "POST" });
    req.headers.set("Authorization", "Bearer valid-token");

    vi.spyOn(req, "formData").mockResolvedValue({
        get: (key: string) => key === "file" ? largeMockFile : null
    } as any);

    const res = await mediaRoutes.handle(req);
    expect(res.status).toBe(413);
  });

  it("Validation: Returns 415 Unsupported Media Type for forbidden type", async () => {
    // Mock an executable file
    const exeFile = {
        name: "app.exe",
        type: "application/x-msdownload",
        size: 1024,
        stream: () => new ReadableStream(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
    };

    const req = new Request("http://localhost/api/media/upload", { method: "POST" });
    req.headers.set("Authorization", "Bearer valid-token");

    vi.spyOn(req, "formData").mockResolvedValue({
        get: (key: string) => key === "file" ? exeFile : null
    } as any);

    const res = await mediaRoutes.handle(req);
    expect(res.status).toBe(415);
  });
});
