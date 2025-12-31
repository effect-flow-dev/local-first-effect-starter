// FILE: src/lib/client/replicache.ts
import { Replicache } from "replicache";
import { Context, Layer, Effect, Schedule } from "effect";
import type { PublicUser } from "../shared/schemas";
import { setupWebSocket } from "./replicache/websocket";
import { clientLog } from "./clientLog";
import { mutators, type ReplicacheMutators } from "./replicache/mutators";
import { puller, pusher } from "./replicache/fetchers";
import { setOnline, setSyncing, updatePendingCount } from "./stores/syncStore";

// Re-export mutators type for usage in components
export type { ReplicacheMutators } from "./replicache/mutators";
export { mutators } from "./replicache/mutators";

export interface IReplicacheService {
  readonly client: Replicache<ReplicacheMutators>;
}

export class ReplicacheService extends Context.Tag("ReplicacheService")<
  ReplicacheService,
  IReplicacheService
>() {}

export const ReplicacheLive = (user: PublicUser) => {
  return Layer.scoped(
    ReplicacheService,
    Effect.gen(function* () {
      yield* clientLog(
        "info",
        `[Replicache] Initializing client for user ${user.id}...`,
      );

      // --- 1. Network Monitoring ---
      const handleOnline = () => setOnline(true);
      const handleOffline = () => setOnline(false);
      
      // Initialize state immediately
      if (typeof navigator !== "undefined") {
        setOnline(navigator.onLine);
      }
      
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      const client = new Replicache({
        licenseKey: "l2c75a896d85a4914a51e54a32338b556",
        name: user.id,
        puller,
        pusher,
        mutators,
        indexes: {
          blocksByNoteId: { jsonPointer: "/note_id", allowEmpty: true },
          // Index for media prefetching (URL presence)
          imagesByUrl: { prefix: "block/", jsonPointer: "/fields/url" },
          // Index for Offline Map Caching
          blocksByGeo: { prefix: "block/", jsonPointer: "/latitude" },
        },
        logLevel: "debug",
        pullInterval: 5000,
      });

      // --- 2. Sync Heartbeat ---
      // 'onSync' is a property on the instance, not a constructor option in recent versions
      client.onSync = (isSyncing: boolean) => {
        setSyncing(isSyncing);
      };

      // --- 3. Mutation Monitoring (Polling) ---
      // Replicache doesn't emit an event for "pending mutations count changed", 
      // so we poll efficiently while the client is active.
      // ✅ FIX: Wrapped in try/catch (Effect.ignore or catchAll) inside the loop to prevent crashing.
      // ✅ FIX: Reduced interval to 250ms for snappier UI/Tests.
      const monitorEffect = Effect.gen(function* () {
          try {
            const pending = yield* Effect.tryPromise({
                try: () => client.experimentalPendingMutations(),
                catch: (e) => e
            });
            
            if (Array.isArray(pending)) {
               updatePendingCount(pending.length);
            }
          } catch  {
             // Swallow transient errors to keep the fiber alive
          }
      }).pipe(
          Effect.catchAll(() => Effect.void), // Safety net for the effect itself
          Effect.repeat(Schedule.spaced("250 millis"))
      );

      // Use Effect.fork (scoped) so these fibers are automatically interrupted 
      // when this layer/scope is closed (e.g. on logout).
      yield* Effect.fork(monitorEffect);
      yield* setupWebSocket(client).pipe(Effect.fork);

      yield* Effect.addFinalizer(() => Effect.gen(function*() {
          window.removeEventListener("online", handleOnline);
          window.removeEventListener("offline", handleOffline);
          yield* Effect.promise(() => client.close());
      }));

      return { client };
    }),
  );
};
