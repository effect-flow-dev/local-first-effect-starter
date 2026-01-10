// FILE: src/server/routes/auth/signup.ts
import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { Argon2id } from "oslo/password";
import { centralDb } from "../../../db/client";
import { effectPlugin } from "../../middleware/effect-plugin";
import { handleAuthResult } from "./utils";
import { createOrganizationHierarchy } from "../../../features/auth/auth.service";
import {
  AuthDatabaseError,
  SubdomainInUseError,
  PasswordHashingError,
} from "../../../features/auth/Errors";
import { v4 as uuidv4 } from "uuid";
import type { UserId } from "../../../lib/shared/schemas";

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

        // 1. Check Subdomain Uniqueness (Routing)
        const existingSubdomain = yield* Effect.tryPromise({
          try: () =>
            centralDb
              .withSchema("public")
              .selectFrom("tenant")
              .select("id")
              .where("subdomain", "=", subdomain)
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        if (existingSubdomain) {
          return yield* Effect.fail(new SubdomainInUseError({ subdomain }));
        }

        // 2. Hash Password
        const hashedPassword = yield* Effect.tryPromise({
          try: () => new Argon2id().hash(password),
          catch: (cause) => new PasswordHashingError({ cause }),
        });

        const strategy = tenantStrategy === "database" ? "database" : "schema";
        const userId = uuidv4() as UserId;

        // 3. Create Full Hierarchy (This creates the User in the new Tenant DB)
        const namePart = email.split('@')[0] || "User";
        
        yield* createOrganizationHierarchy(
            userId,
            email,
            hashedPassword,
            organizationName || `${namePart}'s Org`,
            workspaceName || `${namePart}'s Workspace`,
            subdomain,
            strategy
        );

        return { id: userId, email, error: undefined };
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
