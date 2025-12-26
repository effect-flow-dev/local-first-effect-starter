// FILE: src/features/block/Errors.ts
import { Data } from "effect";

/**
 * Error raised when a database operation for blocks fails.
 */
export class BlockDatabaseError extends Data.TaggedError("BlockDatabaseError")<{
  readonly cause: unknown;
}> {}
