// FILE: src/lib/server/JwtService.ts
import { Data, Effect, Schema } from "effect";
import { createJWT, validateJWT } from "oslo/jwt";
import { TimeSpan } from "oslo";

import { config } from "./Config";
import { AuthError } from "../shared/auth";
import type { PublicUser } from "../shared/schemas";
import { PublicUserSchema } from "../shared/schemas";

export class JwtGenerationError extends Data.TaggedError("JwtGenerationError")<{
  readonly cause: unknown;
}> {}

export class JwtValidationError extends Data.TaggedError("JwtValidationError")<{
  readonly cause: unknown;
}> {}

const secretKey = new TextEncoder().encode(config.jwt.secret);

export const generateToken = (user: PublicUser) =>
  Effect.gen(function* () {
    const payload = yield* Schema.encode(PublicUserSchema)(user).pipe(
      Effect.mapError((cause) => new JwtGenerationError({ cause })),
    );

    return yield* Effect.tryPromise({
      try: () =>
        createJWT(
          "HS256",
          secretKey,
          payload as Record<string, unknown>,
          {
            subject: user.id,
            expiresIn: new TimeSpan(30, "d"),
            includeIssuedTimestamp: true,
          },
        ),
      catch: (cause) => new JwtGenerationError({ cause }),
    });
  });

export const validateToken = (token: string) =>
  Effect.gen(function* () {
    const jwt = yield* Effect.tryPromise({
      try: () => validateJWT("HS256", secretKey, token),
      catch: (cause) => new JwtValidationError({ cause }),
    });

    if (!jwt.payload) {
      return yield* Effect.fail(
        new JwtValidationError({
          cause: "Invalid token payload: missing payload object",
        }),
      );
    }

    const user = yield* Schema.decodeUnknown(PublicUserSchema)(jwt.payload);

    return user;
  }).pipe(
    Effect.catchTags({
      JwtValidationError: (error) =>
        Effect.fail(
          new AuthError({
            _tag: "Unauthorized",
            // ✅ FIX: Detailed error message for debugging
            message: `Invalid or expired token: ${String(error.cause)}`,
          }),
        ),
      ParseError: (cause) =>
        Effect.logError(
          "Failed to parse user from JWT payload",
          cause,
        ).pipe(
          Effect.andThen(
            Effect.fail(
              new AuthError({
                _tag: "Unauthorized",
                message: "Token payload is invalid or corrupted.",
              }),
            ),
          ),
        ),
    }),
  );
