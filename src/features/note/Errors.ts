// FILE: src/features/note/Errors.ts
import { Data } from "effect";

/**
 * Error raised when a database operation for notes (insert, update, delete) fails.
 */
export class NoteDatabaseError extends Data.TaggedError("NoteDatabaseError")<{
  readonly cause: unknown;
}> {}

/**
 * Error raised when attempting to create or rename a note to a title that already exists
 * (and the logic prevents duplication).
 */
export class DuplicateNoteTitleError extends Data.TaggedError(
  "DuplicateNoteTitleError",
) {}

/**
 * Error raised when a requested note cannot be found.
 */
export class NoteNotFoundError extends Data.TaggedError("NoteNotFoundError") {}

/**
 * Error raised when an optimistic lock check fails (Stale Write).
 * This indicates the client's version is behind the server's version.
 */
export class VersionConflictError extends Data.TaggedError(
  "VersionConflictError",
)<{
  readonly blockId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;
}> {}
