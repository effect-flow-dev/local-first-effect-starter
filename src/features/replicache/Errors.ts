// FILE: src/features/replicache/Errors.ts
import { Data } from "effect";

/**
 * Error for when a user is not authenticated/authorized.
 */
export class UnauthorizedError extends Data.TaggedError("UnauthorizedError") {}

/**
 * Error for when the request body doesn't match the expected schema.
 */
export class InvalidRequestError extends Data.TaggedError(
  "InvalidRequestError",
)<{
  readonly message: string;
}> {}

/**
 * Error for when the Pull operation fails internally.
 */
export class PullError extends Data.TaggedError("PullError")<{
  readonly cause: unknown;
}> {}

/**
 * Error for when the Push operation fails internally.
 */
export class PushError extends Data.TaggedError("PushError")<{
  readonly cause: unknown;
}> {}

/**
 * Error for when the client's state is inconsistent with the server (e.g. Time Travel),
 * requiring a full client reset.
 */
export class ClientStateNotFoundError extends Data.TaggedError(
  "ClientStateNotFoundError",
) {}
