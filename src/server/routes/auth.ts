// FILE: src/server/routes/auth.ts
import { Elysia } from "elysia";
import { Effect } from "effect";
import { userContext } from "../context";
import { loginRoute } from "./auth/login";
import { signupRoute } from "./auth/signup";
import { verifyRoute } from "./auth/verify";
import { passwordRoutes } from "./auth/password";
import { centralDb } from "../../db/client";
import { AuthDatabaseError } from "../../features/auth/Errors";
import { effectPlugin } from "../middleware/effect-plugin";

// Explicit interface for the return type to satisfy checks
interface MembershipInfo {
  id: string;
  name: string;
  subdomain: string;
  role: string;
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .use(effectPlugin)
  .use(loginRoute)
  .use(signupRoute)
  .use(verifyRoute)
  .use(passwordRoutes)
  .use(userContext)
  .get("/me", ({ user, tenant, currentRole, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    // Return context-aware identity
    return {
      user,
      tenant,      // Will be null if on root domain
      role: currentRole // Will be null if on root domain
    };
  })
  .get("/memberships", async ({ user, set, runEffect }) => {
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const membershipEffect = Effect.gen(function* () {
      const memberships = yield* Effect.tryPromise({
        try: async () => {
          // ✅ FIX: Removed 'any' casts by relying on corrected Kysely types from generated schema
          const result = await centralDb
            .selectFrom("tenant_membership")
            .innerJoin("tenant", "tenant.id", "tenant_membership.tenant_id")
            .select([
              "tenant.id",
              "tenant.name",
              "tenant.subdomain",
              "tenant_membership.role",
            ])
            .where("tenant_membership.user_id", "=", user.id)
            .execute();
            
          return result as MembershipInfo[];
        },
        catch: (cause) => new AuthDatabaseError({ cause }),
      });
      return { memberships };
    });

    const result = await runEffect(Effect.either(membershipEffect));
    
    if (result._tag === "Left") {
        set.status = 500;
        return { error: "Failed to fetch memberships" };
    }
    
    return result.right;
  });
