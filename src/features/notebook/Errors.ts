import { Data } from "effect";

export class NotebookDatabaseError extends Data.TaggedError(
  "NotebookDatabaseError",
)<{
  readonly cause: unknown;
}> {}

export class NotebookNotFoundError extends Data.TaggedError(
  "NotebookNotFoundError",
) {}
