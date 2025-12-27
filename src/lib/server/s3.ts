// FILE: src/lib/server/s3.ts
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Data, Effect } from "effect";
import type { UserId } from "../../types/generated/central/public/User";
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
    // ✅ FIX: Determine extension from filename or fallback to webp
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

// ✅ NEW: Generic Media Upload
export const uploadMedia = (
  userId: UserId,
  file: File,
): Effect.Effect<string, S3UploadError> =>
  Effect.gen(function* () {
    // Extract extension from MIME type or filename, fallback to bin
    const ext = file.name.split(".").pop() || "bin";
    const uuid = yield* generateUUID();
    // Structure: media/{userId}/{uuid}.{ext}
    const key = `media/${userId}/${uuid}.${ext}`;

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
