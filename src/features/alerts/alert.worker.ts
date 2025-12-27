// FILE: src/features/alerts/alert.worker.ts
import { Effect, Schedule, pipe } from "effect";
import { sql } from "kysely";
import { centralDb, getTenantDb, type TenantConfig } from "../../db/client";
import { sendPushNotification } from "../../lib/server/push";
import type { UserId } from "../../lib/shared/schemas";
import type { TaskId } from "../../types/generated/tenant/tenant_template/Task";

// Temporary interfaces until codegen updates types
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

  // 1. Discovery: Get all tenants
  const tenants = yield* Effect.tryPromise({
    try: () => centralDb.selectFrom("tenant").selectAll().execute(),
    catch: (e) => new Error(`Failed to fetch tenants: ${String(e)}`),
  });

  // 2. Per-Tenant Scan
  for (const tenant of tenants) {
    const tenantConfig: TenantConfig = {
      id: tenant.id,
      tenant_strategy: tenant.tenant_strategy as "schema" | "database",
      database_name: tenant.database_name,
      schema_name: tenant.schema_name,
    };

    const db = getTenantDb(tenantConfig);

    try {
      // 3. Find Due Tasks
      // Criteria: due_at <= NOW(), incomplete, alert not yet sent
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
        catch: (e) => new Error(`Failed to query tasks for tenant ${tenant.id}: ${String(e)}`),
      });

      if (dueTasks.length > 0) {
        yield* Effect.logInfo(`[AlertWorker] Processing ${dueTasks.length} due tasks in tenant: ${tenant.subdomain}`);

        for (const task of dueTasks) {
          const t = task as unknown as TaskWithAlert;

          // 4. Find Subscriptions for User
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
             // 5. Send Notifications
             for (const sub of subs) {
                const s = sub as unknown as PushSubscription;
                const payload = {
                  title: "Task Due",
                  body: t.content || "You have a task due now.",
                  data: { taskId: t.id, url: `/notes` }, // Metadata for click handling
                };

                // Fork individual sends so one failure doesn't block others
                yield* sendPushNotification(
                  { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                  payload
                ).pipe(
                  Effect.catchAll((e) => Effect.logWarning(`[AlertWorker] Push failed for ${t.user_id}: ${e.message}`)),
                  Effect.fork
                );
             }
          } else {
             yield* Effect.logDebug(`[AlertWorker] No subscriptions found for user ${t.user_id}`);
          }

          // 6. Mark as Sent (to prevent loops)
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
        yield* Effect.logError(`[AlertWorker] Error scanning tenant ${tenant.id}`, err);
    } finally {
        // Connection cleanup if needed
    }
  }
});

// Run every minute
export const alertWorkerLive = pipe(
    scanAndAlert,
    Effect.catchAll(e => Effect.logError("[AlertWorker] Cycle failed", e)),
    Effect.repeat(Schedule.spaced("1 minute"))
);
