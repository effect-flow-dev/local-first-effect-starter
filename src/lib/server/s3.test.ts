// FILE: src/lib/server/s3.test.ts
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { Effect } from "effect";
import { uploadMedia } from "./s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { UserId } from "../shared/schemas";

// --- Mocks ---
vi.mock("@aws-sdk/client-s3");
vi.mock("@aws-sdk/lib-storage");

vi.mock("./Config", () => ({
  config: {
    s3: {
      region: "auto",
      endpointUrl: "https://mock-endpoint.com",
      accessKeyId: "mock-key",
      secretAccessKey: "mock-secret",
      bucketName: "mock-bucket",
      publicAvatarUrl: "https://pub-r2.dev",
    },
  },
}));

vi.mock("./utils", () => ({
  generateUUID: () => Effect.succeed("1234-5678-uuid"),
}));

describe("S3 Library", () => {
  beforeAll(() => {
    // Polyfill File.prototype.stream for JSDOM environment if missing.
    // JSDOM's Blob implementation does NOT have .stream(), so we return a simple mock object/string.
    // This allows the s3.ts code `const bodyStream = file.stream()` to succeed.
    if (typeof File !== "undefined" && !File.prototype.stream) {
      File.prototype.stream = function () {
        return "MOCKED_STREAM" as any;
      };
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploadMedia constructs correct S3 key structure and parameters", async () => {
    // 1. Prepare Mock Data
    const mockUserId = "user-123" as UserId;
    const mockFile = new File(["test-content"], "image.png", { type: "image/png" });

    // 2. Mock Upload.done() success
    const mockDone = vi.fn().mockResolvedValue({});
    // We cast Upload to unknown then to the vi.fn type to mock the implementation constructor
    (Upload as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      done: mockDone,
    }));

    // 3. Execute
    const result = await Effect.runPromise(uploadMedia(mockUserId, mockFile));

    // 4. Assertions
    // Public URL format
    expect(result).toBe("https://pub-r2.dev/media/user-123/1234-5678-uuid.png");

    // S3 Upload Parameters
    expect(Upload).toHaveBeenCalledTimes(1);
    expect(Upload).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        Bucket: "mock-bucket",
        // Format: media/{userId}/{uuid}.{ext}
        Key: "media/user-123/1234-5678-uuid.png",
        ContentType: "image/png",
        // Body should contain the result of file.stream()
        Body: "MOCKED_STREAM", 
      }),
    }));
    
    expect(mockDone).toHaveBeenCalled();
  });

  it("uploadMedia handles files without extension", async () => {
    const mockUserId = "user-123" as UserId;
    const mockFile = new File(["content"], "readme", { type: "text/plain" });

    const mockDone = vi.fn().mockResolvedValue({});
    (Upload as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      done: mockDone,
    }));

    const result = await Effect.runPromise(uploadMedia(mockUserId, mockFile));

    // Should default to 'bin' or the name itself if split fails
    expect(result).toBe("https://pub-r2.dev/media/user-123/1234-5678-uuid.readme");
  });
});
