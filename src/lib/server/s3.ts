// FILE: src/lib/server/s3.ts
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Data, Effect } from "effect";
import type { UserId } from "../shared/schemas";
import { config } from "./Config";
import { generateUUID } from "./utils";

export class S3UploadError extends Data.TaggedError("S3UploadError")<{
  readonly cause: unknown;
}> {}

const s3Client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpointUrl,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

export const uploadAvatar = (
  userId: UserId,
  file: File,
): Effect.Effect<string, S3UploadError> =>
  Effect.gen(function* () {
    const ext = file.name.split(".").pop()?.toLowerCase() || "webp";
    const key = `avatars/${userId}/${yield* generateUUID()}.${ext}`;

    const bodyStream = file.stream();

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: config.s3.bucketName,
        Key: key,
        Body: bodyStream,
        ContentType: file.type,
      },
    });

    yield* Effect.tryPromise({
      try: () => upload.done(),
      catch: (cause) => new S3UploadError({ cause }),
    });

    return `${config.s3.publicAvatarUrl}/${key}`;
  });

export const uploadMedia = (
  userId: UserId,
  file: File,
  options?: { filename?: string }
): Effect.Effect<string, S3UploadError> =>
  Effect.gen(function* () {
    const originalName = options?.filename || file.name || "file.bin";
    
    // Attempt to extract extension from the filename, fallback to bin
    const parts = originalName.split(".");
    const ext = parts.length > 1 ? parts.pop()?.toLowerCase() : "bin";
    
    const uuid = yield* generateUUID();
    const key = `media/${userId}/${uuid}.${ext}`;

    const bodyStream = file.stream();

    // Set Content-Disposition to inline; filename="example.pdf"
    // This hints the browser to display it if possible, but provides the correct name on save.
    const contentDisposition = `inline; filename="${originalName.replace(/"/g, '\\"')}"`;

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: config.s3.bucketName,
        Key: key,
        Body: bodyStream,
        ContentType: file.type || "application/octet-stream",
        ContentDisposition: contentDisposition,
      },
    });

    yield* Effect.tryPromise({
      try: () => upload.done(),
      catch: (cause) => new S3UploadError({ cause }),
    });

    return `${config.s3.publicAvatarUrl}/${key}`;
  });
