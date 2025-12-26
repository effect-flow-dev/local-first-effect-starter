// FILE: src/lib/server/crypto.ts
import { randomBytes } from "node:crypto";
import { Effect } from "effect";

// Standalone function wrapper
export const getRandomBytes = (length: number) =>
  Effect.sync(() => randomBytes(length));
