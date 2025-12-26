// FILE: src/features/media/Errors.ts
import { Data } from "effect";

export class MediaUploadError extends Data.TaggedError("MediaUploadError")<{
  readonly cause: unknown;
}> {}

export class InvalidFileTypeError extends Data.TaggedError(
  "InvalidFileTypeError",
)<{
  readonly type: string;
}> {}

export class FileTooLargeError extends Data.TaggedError("FileTooLargeError")<{
  readonly size: number;
  readonly limit: number;
}> {}

// ✅ FIX: Add optional cause to schema so we can wrap formData() errors
export class MissingFileError extends Data.TaggedError("MissingFileError")<{
  readonly cause?: unknown;
}> {}
