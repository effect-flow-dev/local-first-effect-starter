// FILE: src/features/user/Errors.ts
import { Data } from "effect";

/**
 * Error for when a user is not authenticated/authorized for the action.
 */
export class UnauthorizedError extends Data.TaggedError("UnauthorizedError") {}

/**
 * Error for when the avatar file is missing from the request or invalid.
 * Updated to support detailed error messages for debugging.
 */
export class AvatarMissingError extends Data.TaggedError(
  "AvatarMissingError",
)<{
  readonly message?: string;
  readonly cause?: unknown;
}> {}

/**
 * Error for when the upload process (e.g. S3) fails.
 */
export class AvatarUploadError extends Data.TaggedError("AvatarUploadError")<{
  readonly cause: unknown;
}> {}

/**
 * Error for when updating the user record in the database fails.
 */
export class UserDatabaseError extends Data.TaggedError("UserDatabaseError")<{
  readonly cause: unknown;
}> {}
