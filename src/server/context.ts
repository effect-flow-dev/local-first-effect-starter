// FILE: src/server/context.ts
import { Elysia } from "elysia";
import { Effect } from "effect";
import { validateToken } from "../lib/server/JwtService";
import { getTenantDb, centralDb } from "../db/client";
import { config } from "../lib/server/Config";
import type { TenantConfig } from "../db/client";
import type { Tenant } from "../types/generated/central/public/Tenant";

class ContextError extends Error {
  constructor(message: string, public code: number) {
    super(message);
  }
}

export const userContext = (app: Elysia) => app.derive(
  { as: "global" },
  async ({ request, set }) => {
    // --- 1. Extract Token & User (Global Identity) ---
    const authHeader = request.headers.get("authorization");
    let user = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const result = await Effect.runPromise(Effect.either(validateToken(token)));
      if (result._tag === "Right") {
        user = result.right;
      }
    }

    // --- 2. Resolve Tenant (The "Where Am I?" Logic) ---
    const host = request.headers.get("host") || "";
    const rootDomain = config.app.rootDomain;
    
    // Check if we are on the root domain or API domain (No Tenant)
    const isRoot = host === rootDomain || host === `api.${rootDomain}` || host.startsWith("localhost") || host.startsWith("127.0.0.1");
    
    // Extract subdomain: "app.life-io.xyz" -> "app"
    let requestedSubdomain: string | null = null;
    
    if (!isRoot && host.endsWith(`.${rootDomain}`)) {
        requestedSubdomain = host.slice(0, -(rootDomain.length + 1));
    }

    // Explicit Override Header (Useful for Testing/Native App)
    const headerSubdomain = request.headers.get("x-life-io-subdomain");
    if (headerSubdomain) {
      requestedSubdomain = headerSubdomain;
    }

    // If we have a subdomain, look up the Tenant
    let tenant: Tenant | undefined;
    
    if (requestedSubdomain) {
      const result = await centralDb
        .withSchema("public") // ✅ FIX: Force public schema to avoid pollution
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .selectFrom("tenant" as any) 
        .selectAll()
        .where("subdomain", "=", requestedSubdomain)
        .executeTakeFirst();
      
      tenant = result as Tenant | undefined;

      if (!tenant) {
        set.status = 404;
        throw new ContextError(`Tenant '${requestedSubdomain}' not found.`, 404);
      }
    }

    // --- 2.5 Fallback Tenant Resolution (Dev/Test Convenience) ---
    // If on root domain (e.g. 127.0.0.1) and authenticated, but no tenant resolved yet,
    // check if user has exactly ONE membership. If so, auto-contextualize.
    if (!tenant && isRoot && user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const memberships = await centralDb.withSchema("public").selectFrom("tenant_membership" as any)
            .innerJoin("tenant", "tenant.id", "tenant_membership.tenant_id")
            .selectAll("tenant")
            .where("user_id", "=", user.id)
            .execute();
        
        if (memberships.length === 1) {
            tenant = memberships[0] as Tenant;
            console.debug(`[Context] Auto-resolved single tenant context: ${tenant.subdomain}`);
        }
    }

    // --- 3. Authorization (Role Check) ---
    let userDb = null;
    let currentRole = null;

    // If we are in a tenant context
    if (tenant) {
      if (!user) {
        // 401 handled by route logic
      } else {
        // Verify Membership
        const membership = await centralDb
          .withSchema("public") // ✅ FIX: Force public schema
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .selectFrom("tenant_membership" as any)
          .select("role")
          .where("tenant_id", "=", tenant.id)
          .where("user_id", "=", user.id)
          .executeTakeFirst();

        const mem = membership as { role: string } | undefined;

        if (!mem) {
          console.warn(`[Auth] User ${user.id} denied access to tenant ${tenant.subdomain}`);
          set.status = 403;
          return { user, userDb: null, tenant: null, currentRole: null };
        }

        currentRole = mem.role;

        // Initialize Tenant DB Connection
        const tenantConfig: TenantConfig = {
            id: tenant.id,
            tenant_strategy: (tenant.tenant_strategy || "schema") as "schema" | "database",
            database_name: tenant.database_name,
            schema_name: tenant.schema_name
        };
        
        userDb = getTenantDb(tenantConfig);
      }
    }

    return { 
        user, 
        userDb, 
        tenant: tenant || null,
        currentRole 
    };
  },
);
