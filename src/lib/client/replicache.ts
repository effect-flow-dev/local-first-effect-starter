// FILE: src/lib/client/replicache.ts
import { Replicache } from "replicache";
import { Context, Layer, Effect } from "effect";
import type { PublicUser } from "../shared/schemas";
import { setupWebSocket } from "./replicache/websocket";
import { clientLog } from "./clientLog";
import { mutators, type ReplicacheMutators } from "./replicache/mutators";
import { puller, pusher } from "./replicache/fetchers";

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

      const client = new Replicache({
        licenseKey: "l2c75a896d85a4914a51e54a32338b556",
        name: user.id,
        puller,
        pusher,
        mutators,
        indexes: {
          blocksByNoteId: { jsonPointer: "/note_id", allowEmpty: true },
          // ✅ NEW: Index for media prefetching. 
          // Indexes all blocks (prefix: "block/") that have a "url" in their fields.
          // This allows scanning ONLY the images without loading entire note bodies.
          imagesByUrl: { prefix: "block/", jsonPointer: "/fields/url" },
        },
        logLevel: "debug",
        pullInterval: 5000,
      });

      yield* setupWebSocket(client).pipe(Effect.forkDaemon);
      yield* Effect.addFinalizer(() => Effect.promise(() => client.close()));

      return { client };
    }),
  );
};
