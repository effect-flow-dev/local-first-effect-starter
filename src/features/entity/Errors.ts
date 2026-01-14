    // FILE: src/features/entity/Errors.ts
    import { Data } from "effect";

    export class EntityDatabaseError extends Data.TaggedError("EntityDatabaseError")<{
      readonly cause: unknown;
    }> {}

