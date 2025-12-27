// FILE: src/server/routes/push.ts
import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { v4 as uuidv4 } from "uuid";
import { userContext } from "../context";
import { effectPlugin } from "../middleware/effect-plugin";
import { UnauthorizedError } from "../../features/user/Errors";
import type { PushSubscriptionId } from "../../types/generated/tenant/tenant_template/PushSubscription";

export const pushRoutes = new Elysia({ prefix: "/api/push" })
  .use(userContext)
  .use(effectPlugin)
  .post(
    // ✅ FIX: Renamed from /subscribe to /subscription to avoid Eden Treaty type collision
    "/subscription",
    async ({ body, user, userDb, set, runEffect }) => {
      const subscribeEffect = Effect.gen(function* () {
        if (!user || !userDb) {
          return yield* Effect.fail(new UnauthorizedError());
        }

        const { endpoint, keys } = body;

        // Insert or Update Subscription
        yield* Effect.tryPromise({
          try: () =>
            userDb
              .insertInto("push_subscription")
              .values({
                id: uuidv4() as PushSubscriptionId,
                user_id: user.id,
                endpoint,
                p256dh: keys.p256dh,
                auth: keys.auth,
                created_at: new Date(), 
              })
              .onConflict((oc) =>
                oc.column("endpoint").doUpdateSet({
                  p256dh: keys.p256dh,
                  auth: keys.auth,
                })
              )
              .execute(),
          catch: (e) => new Error(`Failed to save subscription: ${String(e)}`),
        });

        return { success: true };
      });

      const result = await runEffect(Effect.either(subscribeEffect));

      if (result._tag === "Left") {
        const err = result.left;
        if (err instanceof UnauthorizedError) {
          set.status = 401;
          return { error: "Unauthorized" };
        }
        console.error("[Push] Subscribe failed:", err);
        set.status = 500;
        return { error: "Internal Server Error" };
      }

      return result.right;
    },
    {
      body: t.Object({
        endpoint: t.String(),
        keys: t.Object({
          p256dh: t.String(),
          auth: t.String(),
        }),
      }),
    }
  );
