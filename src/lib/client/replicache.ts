// FILE: src/lib/client/replicache.ts
import { Replicache } from "replicache";
import { Context, Layer, Effect, Schedule } from "effect";
import type { PublicUser } from "../shared/schemas";
import { setupWebSocket } from "./replicache/websocket";
import { clientLog } from "./clientLog";
import { mutators, type ReplicacheMutators } from "./replicache/mutators";
import { puller, pusher } from "./replicache/fetchers";
import { setOnline, setSyncing, updatePendingCount } from "./stores/syncStore";

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
      yield* clientLog("info", `[Replicache] Init for ${user.id}`);

      const handleOnline = () => setOnline(true);
      const handleOffline = () => setOnline(false);
      if (typeof navigator !== "undefined") setOnline(navigator.onLine);
      
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
          imagesByUrl: { prefix: "block/", jsonPointer: "/fields/url" },
          blocksByGeo: { prefix: "block/", jsonPointer: "/latitude" },
        },
        pullInterval: 5000,
      });

      client.onSync = (isSyncing: boolean) => { setSyncing(isSyncing); };

      // ✅ FIX: Lowered polling interval to 100ms for more accurate "Saved" detection in E2E tests
      const monitorEffect = Effect.gen(function* () {
          try {
            const pending = yield* Effect.tryPromise({
                try: () => client.experimentalPendingMutations(),
                catch: (e) => e
            });
            if (Array.isArray(pending)) updatePendingCount(pending.length);
          } catch {}
      }).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.repeat(Schedule.spaced("100 millis"))
      );

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
