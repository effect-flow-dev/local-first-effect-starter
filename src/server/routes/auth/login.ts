// FILE: src/server/routes/auth/login.ts
import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { Argon2id } from "oslo/password";
import { generateToken } from "../../../lib/server/JwtService";
import { effectPlugin } from "../../middleware/effect-plugin";
import { userContext } from "../../context"; // ✅ Import new context
import { handleAuthResult } from "./utils";
import type { PublicUser } from "../../../lib/shared/schemas";
import {
  AuthDatabaseError,
  InvalidCredentialsError,
  EmailNotVerifiedError,
  PasswordHashingError,
} from "../../../features/auth/Errors";

export const loginRoute = new Elysia()
  .use(userContext) // ✅ Use context to get userDb
  .use(effectPlugin)
  .post(
    "/login",
    async ({ body, userDb, tenant, set, runEffect }) => {
      const loginEffect = Effect.gen(function* () {
        // 1. Context Check
        if (!userDb || !tenant) {
            // Root Domain Login Attempt
            // We cannot authenticate because we don't know WHICH database to check the password against.
            return { 
                error: "Workspace required. Please navigate to your-workspace.life-io.xyz",
                status: 400 
            };
        }

        const { email, password } = body;

        // 2. Query Tenant DB
        const user = yield* Effect.tryPromise({
          try: () =>
            userDb
              .selectFrom("user")
              .selectAll()
              .where("email", "=", email)
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (!user) {
          yield* Effect.logInfo(`[Login] User not found in ${tenant.subdomain}: ${email}`);
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        if (!user.email_verified) {
          yield* Effect.logInfo(`[Login] Unverified email: ${email}`);
          return yield* Effect.fail(new EmailNotVerifiedError());
        }

        // 3. Verify Password (Local Hash)
        const isValidPassword = yield* Effect.tryPromise({
          try: () => new Argon2id().verify(user.password_hash, password),
          catch: (cause) => new PasswordHashingError({ cause }),
        });

        if (!isValidPassword) {
          yield* Effect.logInfo(`[Login] Invalid password for: ${email}`);
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        // 4. Issue Token
        const { password_hash: _ph, ...publicUser } = user;
        const token = yield* generateToken(publicUser as unknown as PublicUser);

        yield* Effect.logInfo(`[Login] Success: ${email} @ ${tenant.subdomain}`);
        return { user: publicUser, token, error: undefined };
      });

      const result = await runEffect(Effect.either(loginEffect));
      
      // Handle the "Root Domain" explicit return case
      if (result._tag === "Right" && 'status' in (result.right as any)) {
          const r = result.right as { status: number, error: string };
          set.status = r.status;
          return { error: r.error };
      }

      return handleAuthResult(result, set);
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
    },
  );
