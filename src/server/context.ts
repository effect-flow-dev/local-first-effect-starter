// File: src/server/context.ts
// ------------------------
import { Elysia } from "elysia";
import { Effect, Schema } from "effect";
import { validateToken } from "../lib/server/JwtService";
import { getTenantDb, centralDb } from "../db/client";
import { config } from "../lib/server/Config";
import type { Tenant } from "../types/generated/central/public/Tenant";
import { PublicUserSchema, type PublicUser } from "../lib/shared/schemas";

export const userContext = (app: Elysia) => app.derive(
  { as: "global" },
  async ({ request }) => {
    const host = request.headers.get("host") || "";
    const headerSubdomain = request.headers.get("x-life-io-subdomain");
    const rootDomain = config.app.rootDomain; 

    let requestedSubdomain: string | null = null;

    if (headerSubdomain) {
      requestedSubdomain = headerSubdomain;
    } else {
      const hostname = host.split(":")[0] || ""; 
      if (hostname !== rootDomain && hostname.endsWith(`.${rootDomain}`)) {
        requestedSubdomain = hostname.replace(`.${rootDomain}`, "");
      }
    }

    let tenant: Tenant | undefined;
    let userDb = null;

    if (requestedSubdomain) {
      tenant = await centralDb
        .withSchema("public")
        .selectFrom("tenant")
        .selectAll()
        .where("subdomain", "=", requestedSubdomain)
        .executeTakeFirst();

      if (tenant) {
        userDb = getTenantDb({
          id: tenant.id,
          tenant_strategy: (tenant.tenant_strategy || "schema") as "schema" | "database",
          database_name: tenant.database_name,
          schema_name: tenant.schema_name
        });
      }
    }

    const authHeader = request.headers.get("authorization");
    let user: PublicUser | null = null;
    let currentRole = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const result = await Effect.runPromise(Effect.either(validateToken(token)));
      
      if (result._tag === "Right") {
        const tokenUser = result.right;

        if (userDb) {
          try {
              const localUser = await userDb
                .selectFrom("user")
                .selectAll()
                .where("id", "=", tokenUser.id)
                .executeTakeFirst();

              if (localUser) {
                user = Schema.decodeUnknownSync(PublicUserSchema)({
                  ...localUser,
                  created_at: localUser.created_at,
                });
                currentRole = "OWNER"; 
              }
          } catch (e) {
              const err = e as { code?: string };
              // ✅ SILENT ERROR: Do not log 42P01 during E2E cleanup races
              if (err.code !== '42P01') {
                  console.error("[Context] DB query failed:", e);
              }
          }
        } else {
          user = tokenUser;
        }
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
