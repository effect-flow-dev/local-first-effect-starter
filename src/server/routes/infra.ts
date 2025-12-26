// FILE: src/server/routes/infra.ts
import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { centralDb } from "../../db/client";
import { config } from "../../lib/server/Config";
import { effectPlugin } from "../middleware/effect-plugin"; // ✅ Import Plugin

export const infraRoutes = new Elysia({ prefix: "/api/infra" })
  .use(effectPlugin) // ✅ Enable runEffect
  .get(
    "/caddy-ask",
    async ({ query, set, runEffect }) => { // ✅ Destructure runEffect
      const logic = Effect.gen(function* () {
        // Caddy passes the domain being requested via query param: ?domain=xyz.com
        const { domain } = query;

        if (!domain) {
          set.status = 400;
          return "Missing domain";
        }

        // 1. Allow the Root Domain
        if (domain === config.app.rootDomain) {
          set.status = 200;
          return "Allowed (Root)";
        }

        // 2. Allow the explicit API subdomain (for mobile/auth)
        if (domain === `api.${config.app.rootDomain}`) {
          set.status = 200;
          return "Allowed (API)";
        }

        // 3. Validate Tenant Subdomains
        const rootSuffix = `.${config.app.rootDomain}`;
        if (!domain.endsWith(rootSuffix)) {
          // Reject domains that don't match our root (e.g. random headers)
          set.status = 403;
          return "Forbidden Domain";
        }

        // Extract "app" from "app.life-io.xyz"
        const subdomain = domain.slice(0, -rootSuffix.length);

        // Check Central DB
        const exists = yield* Effect.tryPromise(async () => {
          const user = await centralDb
            .selectFrom("user")
            .select("id")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .where("subdomain" as any, "=", subdomain)
            .executeTakeFirst();
          return !!user;
        }).pipe(
          Effect.catchAll(() => Effect.succeed(false)),
        );

        if (exists) {
          set.status = 200;
          return "Allowed";
        } else {
          set.status = 403;
          return "Denied";
        }
      });

      // ✅ Use runEffect to wrap the logic in a span
      return runEffect(logic);
    },
    {
      query: t.Object({
        domain: t.String(),
      }),
    },
  );
