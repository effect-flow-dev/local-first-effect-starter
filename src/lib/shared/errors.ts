import { Data } from "effect";

export class NoteTitleExistsError extends Data.TaggedError(
  "NoteTitleExistsError",
) {}
