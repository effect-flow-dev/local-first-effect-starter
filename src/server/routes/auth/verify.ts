// FILE: src/server/routes/auth/verify.ts
import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { isWithinExpirationDate } from "oslo";
import { userContext } from "../../context"; // ✅ Import context
import { generateToken } from "../../../lib/server/JwtService";
import { effectPlugin } from "../../middleware/effect-plugin";
import { handleAuthResult } from "./utils";
import type { EmailVerificationTokenId } from "../../../types/generated/tenant/tenant_template/EmailVerificationToken";
import type { PublicUser } from "../../../lib/shared/schemas";
import {
  AuthDatabaseError,
  TokenInvalidError,
} from "../../../features/auth/Errors";

export const verifyRoute = new Elysia()
  .use(userContext) // ✅ Need DB context
  .use(effectPlugin)
  .post(
    "/verifyEmail",
    async ({ body, userDb, set, runEffect }) => {
      const verifyEffect = Effect.gen(function* () {
        if (!userDb) {
            return yield* Effect.fail(new AuthDatabaseError({ cause: "No tenant context found" }));
        }

        const { token } = body;

        const storedToken = yield* Effect.tryPromise({
          try: () =>
            userDb
              .deleteFrom("email_verification_token")
              .where("id", "=", token as EmailVerificationTokenId)
              .returningAll()
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (!storedToken) {
          return yield* Effect.fail(
            new TokenInvalidError({ cause: "Token not found in DB" }),
          );
        }

        if (!isWithinExpirationDate(storedToken.expires_at)) {
          return yield* Effect.fail(
            new TokenInvalidError({ cause: "Token expired" }),
          );
        }

        const user = yield* Effect.tryPromise({
          try: () =>
            userDb
              .updateTable("user")
              .set({ email_verified: true })
              .where("id", "=", storedToken.user_id)
              .returningAll()
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (!user) {
          return yield* Effect.fail(
            new AuthDatabaseError({ cause: "User not found for token" }),
          );
        }

        const { password_hash: _ph, ...publicUser } = user;
        const jwt = yield* generateToken(publicUser as unknown as PublicUser);

        return { user: publicUser, token: jwt, error: undefined };
      });

      const result = await runEffect(Effect.either(verifyEffect));
      return handleAuthResult(result, set);
    },
    {
      body: t.Object({
        token: t.String(),
      }),
    },
  );
