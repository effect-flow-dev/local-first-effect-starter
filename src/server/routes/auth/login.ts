// FILE: src/server/routes/auth/login.ts
import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { Argon2id } from "oslo/password";
import { centralDb } from "../../../db/client";
import { generateToken } from "../../../lib/server/JwtService";
import { effectPlugin } from "../../middleware/effect-plugin";
import { handleAuthResult } from "./utils";
import type { PublicUser } from "../../../lib/shared/schemas";
import {
  AuthDatabaseError,
  InvalidCredentialsError,
  EmailNotVerifiedError,
  PasswordHashingError,
} from "../../../features/auth/Errors";

export const loginRoute = new Elysia()
  .use(effectPlugin)
  .post(
    "/login",
    async ({ body, set, runEffect }) => {
      const loginEffect = Effect.gen(function* () {
        const { email, password } = body;

        const user = yield* Effect.tryPromise({
          try: () =>
            centralDb
              .selectFrom("user")
              .selectAll()
              .where("email", "=", email)
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (!user) {
          yield* Effect.logInfo(`[Login] User not found: ${email}`);
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        if (!user.email_verified) {
          yield* Effect.logInfo(`[Login] Unverified email: ${email}`);
          return yield* Effect.fail(new EmailNotVerifiedError());
        }

        const isValidPassword = yield* Effect.tryPromise({
          try: () => new Argon2id().verify(user.password_hash, password),
          catch: (cause) => new PasswordHashingError({ cause }),
        });

        if (!isValidPassword) {
          yield* Effect.logInfo(`[Login] Invalid password for: ${email}`);
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        const { password_hash: _ph, ...publicUser } = user;
        const token = yield* generateToken(publicUser as unknown as PublicUser);

        yield* Effect.logInfo(`[Login] Success: ${email}`);
        return { user: publicUser, token, error: undefined };
      });

      const result = await runEffect(Effect.either(loginEffect));
      return handleAuthResult(result, set);
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
    },
  );
