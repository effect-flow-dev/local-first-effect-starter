// FILE: src/server/routes/auth/password.ts
import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { Argon2id } from "oslo/password";
import { isWithinExpirationDate } from "oslo";
import { centralDb } from "../../../db/client";
import { effectPlugin } from "../../middleware/effect-plugin";
import { userContext } from "../../context";
import { handleAuthResult } from "./utils";
import {
  createPasswordResetToken,
  sendPasswordResetEmail,
} from "../../../features/auth/auth.service";
import type { PasswordResetTokenId } from "../../../types/generated/public/PasswordResetToken";
import {
  AuthDatabaseError,
  TokenInvalidError,
  PasswordHashingError,
  InvalidCredentialsError,
} from "../../../features/auth/Errors";

export const passwordRoutes = new Elysia()
  .use(effectPlugin)
  .post(
    "/requestPasswordReset",
    async ({ body, set, runEffect }) => {
      const requestResetEffect = Effect.gen(function* () {
        const { email } = body;

        const user = yield* Effect.tryPromise({
          try: () =>
            centralDb
              .selectFrom("user")
              .select(["id", "email", "email_verified"])
              .where("email", "=", email)
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (user && user.email_verified) {
          const token = yield* createPasswordResetToken(user.id);
          yield* sendPasswordResetEmail(user.email, token);
        }

        return { success: true };
      });

      const result = await runEffect(Effect.either(requestResetEffect));
      return handleAuthResult(result, set);
    },
    {
      body: t.Object({
        email: t.String(),
      }),
    },
  )
  .post(
    "/resetPassword",
    async ({ body, set, runEffect }) => {
      const resetEffect = Effect.gen(function* () {
        const { token, newPassword } = body;

        const storedToken = yield* Effect.tryPromise({
          try: () =>
            centralDb
              .deleteFrom("password_reset_token")
              .where("id", "=", token as PasswordResetTokenId)
              .returningAll()
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (!storedToken) {
          return yield* Effect.fail(
            new TokenInvalidError({ cause: "Token not found" }),
          );
        }

        if (!isWithinExpirationDate(storedToken.expires_at)) {
          return yield* Effect.fail(
            new TokenInvalidError({ cause: "Token expired" }),
          );
        }

        const newHash = yield* Effect.tryPromise({
          try: () => new Argon2id().hash(newPassword),
          catch: (cause) => new PasswordHashingError({ cause }),
        });

        yield* Effect.tryPromise({
          try: () =>
            centralDb
              .updateTable("user")
              .set({ password_hash: newHash })
              .where("id", "=", storedToken.user_id)
              .execute(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        return { success: true, error: undefined };
      });

      const result = await runEffect(Effect.either(resetEffect));
      return handleAuthResult(result, set);
    },
    {
      body: t.Object({
        token: t.String(),
        newPassword: t.String(),
      }),
    },
  )
  .use(userContext)
  .post(
    "/change-password",
    async ({ body, user, set, runEffect }) => {
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const changeEffect = Effect.gen(function* () {
        const { oldPassword, newPassword } = body;

        const fullUser = yield* Effect.tryPromise({
          try: () =>
            centralDb
              .selectFrom("user")
              .selectAll()
              .where("id", "=", user.id)
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (!fullUser) {
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        const validOldPassword = yield* Effect.tryPromise({
          try: () => new Argon2id().verify(fullUser.password_hash, oldPassword),
          catch: (cause) => new PasswordHashingError({ cause }),
        });

        if (!validOldPassword) {
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        const newHash = yield* Effect.tryPromise({
          try: () => new Argon2id().hash(newPassword),
          catch: (cause) => new PasswordHashingError({ cause }),
        });

        yield* Effect.tryPromise({
          try: () =>
            centralDb
              .updateTable("user")
              .set({ password_hash: newHash })
              .where("id", "=", user.id)
              .execute(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        return { success: true };
      });

      const result = await runEffect(Effect.either(changeEffect));
      return handleAuthResult(result, set);
    },
    {
      body: t.Object({
        oldPassword: t.String(),
        newPassword: t.String(),
      }),
    },
  );
