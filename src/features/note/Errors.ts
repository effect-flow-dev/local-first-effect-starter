// File: src/features/note/Errors.ts
import { Data } from "effect";

/**
 * Error raised when a database operation for notes fails.
 * We ensure 'cause' is explicitly typed as unknown to preserve the 
 * underlying Postgres/Kysely error object for logging.
 */
export class NoteDatabaseError extends Data.TaggedError("NoteDatabaseError")<{
  readonly cause: unknown;
  readonly message?: string;
}> {}

export class DuplicateNoteTitleError extends Data.TaggedError(
  "DuplicateNoteTitleError",
) {}

export class NoteNotFoundError extends Data.TaggedError("NoteNotFoundError") {}

export class VersionConflictError extends Data.TaggedError(
  "VersionConflictError",
)<{
  readonly blockId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;
}> {}
