// FILE: src/features/alerts/alert.worker.ts
import { Effect, Schedule, pipe } from "effect";
import { sql } from "kysely";
import { centralDb, getTenantDb, type TenantConfig } from "../../db/client";
import { sendPushNotification } from "../../lib/server/push";
import type { UserId } from "../../lib/shared/schemas";
import type { TaskId } from "../../types/generated/tenant/tenant_template/Task";

interface TaskWithAlert {
  id: string;
  content: string;
  user_id: string;
  due_at: Date;
}

interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export const scanAndAlert = Effect.gen(function* () {
  yield* Effect.logDebug("[AlertWorker] Starting scan cycle...");

  const tenants = yield* Effect.tryPromise({
    try: () => centralDb.selectFrom("tenant").selectAll().execute(),
    catch: (e) => new Error(`Failed to fetch tenants: ${String(e)}`),
  });

  for (const tenant of tenants) {
    // Wrap each tenant processing in a try/catch block to ensure one failure doesn't crash the loop
    try {
        const tenantConfig: TenantConfig = {
          id: tenant.id,
          tenant_strategy: tenant.tenant_strategy as "schema" | "database",
          database_name: tenant.database_name,
          schema_name: tenant.schema_name,
        };

        const db = getTenantDb(tenantConfig);

        const dueTasks = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom("task")
              .select(["id", "content", "user_id"])
              .select("due_at")
              .where("due_at", "<=", sql<Date>`now()`)
              .where("is_complete", "=", false)
              .where("alert_sent_at", "is", null)
              .execute(),
          catch: (e) => {
              // Check for Postgres "relation does not exist" error (code 42P01)
              // This happens if the worker runs while a tenant is being provisioned or de-provisioned.
              const err = e as { code?: string, message?: string };
              if (err.code === '42P01') {
                  return new Error(`Tenant ${tenant.id} not ready (missing tables). Skipping.`);
              }
              return new Error(`Failed to query tasks for tenant ${tenant.id}: ${String(e)}`);
          },
        });

        if (dueTasks.length > 0) {
          yield* Effect.logInfo(`[AlertWorker] Processing ${dueTasks.length} due tasks in tenant: ${tenant.subdomain}`);

          for (const task of dueTasks) {
            const t = task as unknown as TaskWithAlert;

            const subs = yield* Effect.tryPromise({
              try: () =>
                db
                  .selectFrom("push_subscription")
                  .select(["endpoint", "p256dh", "auth"])
                  .where("user_id", "=", t.user_id as UserId)
                  .execute(),
              catch: (e) => new Error(`Failed to fetch subscriptions: ${String(e)}`),
            });

            if (subs.length > 0) {
               for (const sub of subs) {
                  const s = sub as unknown as PushSubscription;
                  const payload = {
                    title: "Task Due",
                    body: t.content || "You have a task due now.",
                    data: { taskId: t.id, url: `/notes` }, 
                  };

                  yield* sendPushNotification(
                    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                    payload
                  ).pipe(
                    Effect.catchAll((e) => Effect.logWarning(`[AlertWorker] Push failed for ${t.user_id}: ${e.message}`)),
                    Effect.fork
                  );
               }
            }

            yield* Effect.tryPromise({
                try: () =>
                  db
                    .updateTable("task")
                    .set({ alert_sent_at: sql`now()` })
                    .where("id", "=", t.id as TaskId)
                    .execute(),
                catch: (e) => new Error(`Failed to update task ${t.id}: ${String(e)}`),
            });
          }
        }

    } catch (err) {
        // This catch block handles any errors thrown by Effect.tryPromise failures above (via yield*)
        // or any synchronous errors in the loop.
        const msg = err instanceof Error ? err.message : String(err);
        
        // Suppress "not ready" logs to debug level
        if (msg.includes("not ready")) {
            yield* Effect.logDebug(`[AlertWorker] ${msg}`);
        } else {
            yield* Effect.logError(`[AlertWorker] Error scanning tenant ${tenant.id}: ${msg}`);
        }
    }
  }
});

export const alertWorkerLive = pipe(
    scanAndAlert,
    // ✅ FIX: Properly format the error message for logging.
    Effect.catchAll(e => Effect.logError(`[AlertWorker] Cycle failed. Cause: ${e instanceof Error ? e.message : String(e)}`)),
    Effect.repeat(Schedule.spaced("1 minute"))
);
