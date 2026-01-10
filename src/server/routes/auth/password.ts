// FILE: src/server/routes/auth/password.ts
import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { Argon2id } from "oslo/password";
import { isWithinExpirationDate } from "oslo";
import { effectPlugin } from "../../middleware/effect-plugin";
import { userContext } from "../../context"; // ✅ Import Context
import { handleAuthResult } from "./utils";
import {
  createPasswordResetToken,
  sendPasswordResetEmail,
} from "../../../features/auth/auth.service";
import type { PasswordResetTokenId } from "../../../types/generated/tenant/tenant_template/PasswordResetToken"; // ✅ Fixed Import
import {
  AuthDatabaseError,
  TokenInvalidError,
  PasswordHashingError,
  InvalidCredentialsError,
} from "../../../features/auth/Errors";

export const passwordRoutes = new Elysia()
  .use(effectPlugin)
  .use(userContext) // ✅ Apply Context globally to these routes to access userDb
  .post(
    "/requestPasswordReset",
    async ({ body, set, runEffect, userDb, tenant }) => {
      const requestResetEffect = Effect.gen(function* () {
        if (!userDb || !tenant) {
            set.status = 400;
            return { error: "Workspace required for password reset." };
        }

        const { email } = body;

        // ✅ Use userDb (Tenant DB)
        const user = yield* Effect.tryPromise({
          try: () =>
            userDb
              .selectFrom("user")
              .select(["id", "email", "email_verified"])
              .where("email", "=", email)
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (user && user.email_verified) {
          // ✅ Pass userDb
          const token = yield* createPasswordResetToken(userDb, user.id);
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
    async ({ body, set, runEffect, userDb, tenant }) => {
      const resetEffect = Effect.gen(function* () {
        if (!userDb || !tenant) {
            set.status = 400;
            return { error: "Workspace required for password reset." };
        }

        const { token, newPassword } = body;

        // ✅ Use userDb (Tenant DB)
        const storedToken = yield* Effect.tryPromise({
          try: () =>
            userDb
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
            userDb
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
  .post(
    "/change-password",
    async ({ body, user, userDb, set, runEffect }) => {
      if (!user || !userDb) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const changeEffect = Effect.gen(function* () {
        const { oldPassword, newPassword } = body;

        // ✅ Use userDb (Tenant DB)
        const fullUser = yield* Effect.tryPromise({
          try: () =>
            userDb
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
            userDb
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
