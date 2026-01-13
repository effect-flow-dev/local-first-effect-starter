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
    const mockUserId = "user-123" as UserId;
    const mockFile = new File(["test-content"], "image.png", { type: "image/png" });

    const mockDone = vi.fn().mockResolvedValue({});
    (Upload as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      done: mockDone,
    }));

    const result = await Effect.runPromise(uploadMedia(mockUserId, mockFile));

    expect(result).toBe("https://pub-r2.dev/media/user-123/1234-5678-uuid.png");

    expect(Upload).toHaveBeenCalledTimes(1);
    expect(Upload).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        Bucket: "mock-bucket",
        Key: "media/user-123/1234-5678-uuid.png",
        ContentType: "image/png",
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

    // ✅ FIX: Expect .bin suffix for extensionless files (matches s3.ts implementation)
    expect(result).toBe("https://pub-r2.dev/media/user-123/1234-5678-uuid.bin");
  });
});
