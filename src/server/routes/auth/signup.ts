// FILE: src/server/routes/auth/signup.ts
import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { Argon2id } from "oslo/password";
import { centralDb } from "../../../db/client";
import { effectPlugin } from "../../middleware/effect-plugin";
import { handleAuthResult } from "./utils";
import {
  createVerificationToken,
  sendVerificationEmail,
  createOrganizationHierarchy,
} from "../../../features/auth/auth.service";
import {
  AuthDatabaseError,
  EmailInUseError,
  SubdomainInUseError,
  PasswordHashingError,
} from "../../../features/auth/Errors";

export const signupRoute = new Elysia()
  .use(effectPlugin)
  .post(
    "/signup",
    async ({ body, set, runEffect }) => {
      const signupEffect = Effect.gen(function* () {
        const { 
            email, 
            password, 
            tenantStrategy, 
            subdomain,
            organizationName, 
            workspaceName 
        } = body;

        // 1. Check Email Uniqueness
        const existingEmail = yield* Effect.tryPromise({
          try: () =>
            centralDb
              .withSchema("public") // ✅ FIX
              .selectFrom("user")
              .select("id")
              .where("email", "=", email)
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (existingEmail) {
          return yield* Effect.fail(
            new EmailInUseError({
              email,
              cause: "Duplicate email registration attempt",
            }),
          );
        }

        // 2. Check Subdomain Uniqueness (in Tenant table now)
        const existingSubdomain = yield* Effect.tryPromise({
          try: () =>
            centralDb
              .withSchema("public") // ✅ FIX
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .selectFrom("tenant" as any)
              .select("id")
              .where("subdomain", "=", subdomain)
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (existingSubdomain) {
          return yield* Effect.fail(new SubdomainInUseError({ subdomain }));
        }

        // 3. Hash Password
        const hashedPassword = yield* Effect.tryPromise({
          try: () => new Argon2id().hash(password),
          catch: (cause) => new PasswordHashingError({ cause }),
        });

        const strategy = tenantStrategy === "database" ? "database" : "schema";

        // 4. Create Global User
        const newUser = yield* Effect.tryPromise({
          try: () =>
            centralDb
              .withSchema("public") // ✅ FIX
              .insertInto("user")
              .values({
                  email,
                  password_hash: hashedPassword,
                  email_verified: false,
                  // Deprecated fields set to null/default
                  avatar_url: null,
                  created_at: new Date(),
                  permissions: []
              })
              .returningAll()
              .executeTakeFirstOrThrow(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        // 5. Create Hierarchy & Provision
        // Safe defaults
        const namePart = email.split('@')[0] || "User";
        const finalOrgName = organizationName || `${namePart}'s Org`;
        const finalTenantName = workspaceName || `${namePart}'s Workspace`;

        yield* createOrganizationHierarchy(
            newUser.id,
            newUser.email,
            finalOrgName,
            finalTenantName,
            subdomain,
            strategy
        );

        // 6. Verification Flow
        const token = yield* createVerificationToken(newUser.id, newUser.email);
        yield* sendVerificationEmail(newUser.email, token);

        return { id: newUser.id, email: newUser.email, error: undefined };
      });

      const result = await runEffect(Effect.either(signupEffect));
      return handleAuthResult(result, set);
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
        subdomain: t.String({
          pattern: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$",
          minLength: 3,
          maxLength: 63,
        }),
        tenantStrategy: t.Optional(
          t.Union([t.Literal("schema"), t.Literal("database")]),
        ),
        organizationName: t.Optional(t.String()),
        workspaceName: t.Optional(t.String()),
      }),
    },
  );
