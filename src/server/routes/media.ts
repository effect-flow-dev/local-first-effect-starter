// FILE: src/server/routes/media.ts
import { Elysia } from "elysia";
import { Effect, Either } from "effect";
import { userContext } from "../context";
import { effectPlugin } from "../middleware/effect-plugin";
import { uploadMedia } from "../../lib/server/s3";
import {
  FileTooLargeError,
  InvalidFileTypeError,
  MediaUploadError,
  MissingFileError,
} from "../../features/media/Errors";
import { UnauthorizedError } from "../../features/user/Errors";

// Max file size: 50MB (Increased from 10MB for larger docs/PDFs)
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

// Expanded Allow List
const ALLOWED_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  // Documents
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  // Microsoft Office
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  // Generic
  "application/octet-stream" 
];

const handleMediaResult = <A>(
  result: Either.Either<A, unknown>,
  set: { status?: number | string },
) => {
  if (Either.isRight(result)) {
    return result.right;
  }

  const error = result.left;

  if (error instanceof UnauthorizedError) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  if (error instanceof MissingFileError) {
    console.error("[Media] 400 MissingFileError:", error.message || "No valid file found");
    set.status = 400; // Bad Request
    return { error: error.message || "No file provided" };
  }
  if (error instanceof FileTooLargeError) {
    set.status = 413; // Payload Too Large
    return { error: `File too large. Max size is ${error.limit / 1024 / 1024}MB` };
  }
  if (error instanceof InvalidFileTypeError) {
    set.status = 415; // Unsupported Media Type
    return { error: `Invalid file type: ${error.type}` };
  }
  if (error instanceof MediaUploadError) {
    console.error("[Media] 503 Upload failed (Upstream):", error.cause);
    set.status = 503; // Service Unavailable
    return { error: "Service Unavailable: Failed to upload file" };
  }

  console.error("[Media] Unexpected error:", error);
  set.status = 500;
  return { error: "Internal Server Error" };
};

// Helper to safely check if an object acts like a File (Duck Typing)
const isFile = (val: unknown): val is File => {
  if (!val || typeof val !== "object") return false;
  return (
    val instanceof File ||
    ("name" in val && "size" in val && "type" in val && "stream" in val)
  );
};

export const mediaRoutes = new Elysia({ prefix: "/api/media" })
  .use(userContext)
  .use(effectPlugin)
  .post(
    "/upload",
    async ({ request, user, set, runEffect }) => {
      const uploadLogic = Effect.gen(function* () {
        if (!user) {
          return yield* Effect.fail(new UnauthorizedError());
        }

        let formData: FormData;
        try {
          formData = yield* Effect.tryPromise({
            try: () => request.formData(),
            catch: (e) => new MissingFileError({ cause: e, message: "Failed to parse form data" }),
          });
        } catch {
          return yield* Effect.fail(new MissingFileError({ message: "Failed to parse form data structure" }));
        }

        const file = formData.get("file");

        if (!isFile(file)) {
          console.debug("[Media] Validation failed: Object is not a valid File.");
          return yield* Effect.fail(new MissingFileError({ message: "Field 'file' is missing or invalid" }));
        }

        const validFile = file;

        // 1. Validate Size
        if (validFile.size > MAX_SIZE_BYTES) {
          console.warn(`[Media] File too large: ${validFile.size} > ${MAX_SIZE_BYTES}`);
          return yield* Effect.fail(
            new FileTooLargeError({ size: validFile.size, limit: MAX_SIZE_BYTES }),
          );
        }

        // 2. Validate Type (Normalized)
        // ✅ FIX: Ensure result is a string, even if split returns undefined element (defensive)
        const rawType = validFile.type.split(';')[0] ?? "";
        const normalizedType = rawType.trim().toLowerCase();

        if (!ALLOWED_MIME_TYPES.includes(normalizedType)) {
          console.warn(`[Media] Invalid MIME type: ${validFile.type} (Normalized: ${normalizedType})`);
          return yield* Effect.fail(
            new InvalidFileTypeError({ type: validFile.type, allowedTypes: ALLOWED_MIME_TYPES }),
          );
        }

        // 3. Upload with Metrics
        const startTime = performance.now();
        const filename = validFile.name || "unknown_file";
        
        console.info(`[Media] Starting S3 upload for user ${user.id} (${validFile.type}, ${validFile.size} bytes, name: ${filename})...`);
        
        // Pass filename explicitly to S3 service
        const url = yield* uploadMedia(user.id, validFile, { filename }).pipe(
          Effect.mapError((cause) => new MediaUploadError({ cause })),
        );

        const duration = Math.round(performance.now() - startTime);
        console.info(`[Media] Upload success. Duration: ${duration}ms.`);

        return { url, filename: validFile.name, size: validFile.size, mimeType: validFile.type };
      });

      const result = await runEffect(Effect.either(uploadLogic));
      return handleMediaResult(result, set);
    },
    {
      // No strict schema validation for multipart/form-data to allow custom parsing
    },
  );
