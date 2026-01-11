// FILE: src/lib/client/runtime.ts
import {
  Effect,
  Layer,
  Runtime,
  Scope,
  ExecutionStrategy,
  Exit,
  Cause,
  Context // ✅ FIX: Added Context import
} from "effect";
import { clientLog } from "./clientLog";
import { LocationLive, LocationService } from "./LocationService";
import { ReplicacheLive, ReplicacheService } from "./replicache";
import { MediaSyncLive, MediaSyncService } from "./media/MediaSyncService";
import { HlcLive, HlcService } from "./hlc/HlcService"; 
import { startMapPrefetch } from "./MapCacheService"; 
import { startMediaPrefetch } from "./MediaCacheService"; 
import type { PublicUser } from "../shared/schemas";
import { addToast } from "./stores/toastStore";

// Base context only needs LocationService
export type BaseClientContext = LocationService;
// Full context includes Replicache, MediaSync, and HlcService
export type FullClientContext = BaseClientContext | ReplicacheService | MediaSyncService | HlcService;

export const BaseClientLive = LocationLive;

const appScope = Effect.runSync(Scope.make());

// Create the initial runtime
export const AppRuntime = Effect.runSync(
  Scope.extend(Layer.toRuntime(BaseClientLive), appScope),
);

// This variable holds the current runtime
export let clientRuntime: Runtime.Runtime<FullClientContext> =
  AppRuntime as Runtime.Runtime<FullClientContext>;

let replicacheScope: Scope.CloseableScope | null = null;

/**
 * Helper for synchronous access to HlcService in Replicache Mutators
 */
export const getHlcServiceSync = () => {
    try {
        return Context.get(clientRuntime.context, HlcService);
    } catch {
        return null;
    }
};

export const activateReplicacheRuntime = (user: PublicUser) =>
  Effect.gen(function* () {
    yield* clientLog("info", "--> [runtime] Activating Replicache runtime...");
    if (replicacheScope) {
      yield* clientLog(
        "warn",
        "[runtime] An existing replicacheScope was found during activation. Closing it first.",
      );
      yield* Scope.close(replicacheScope, Exit.succeed(undefined));
    }

    const newScope = yield* Scope.fork(appScope, ExecutionStrategy.sequential);
    replicacheScope = newScope;

    const hlcLayer = HlcLive(user.id);
    const replicacheLayer = ReplicacheLive(user);
    const mediaSyncLayer = MediaSyncLive.pipe(Layer.provide(replicacheLayer));
    
    const authenticatedLayer = Layer.mergeAll(replicacheLayer, mediaSyncLayer, hlcLayer);
    const fullLayer = Layer.merge(BaseClientLive, authenticatedLayer);

    const newRuntime = yield* Scope.extend(
      Layer.toRuntime(fullLayer),
      newScope,
    );
    clientRuntime = newRuntime;

    // Start Background Services
    startMapPrefetch();
    startMediaPrefetch();

    yield* clientLog(
      "info",
      "<-- [runtime] Replicache, MediaSync, HLC, MapCache & MediaCache runtimes activated successfully.",
    );
  });

export const deactivateReplicacheRuntime = () =>
  Effect.gen(function* () {
    if (replicacheScope) {
      yield* clientLog(
        "info",
        "--> [runtime] Deactivating Replicache runtime...",
      );
      const scopeToClose = replicacheScope;
      replicacheScope = null;
      
      clientRuntime = AppRuntime as Runtime.Runtime<FullClientContext>;
      
      yield* clientLog(
        "info",
        "<-- [runtime] Replicache runtime deactivated successfully. Scope closing in background.",
      );
      return yield* Scope.close(scopeToClose, Exit.succeed(undefined));
    } else {
      yield* clientLog(
        "info",
        "[runtime] Deactivation called, but no replicacheScope was active.",
      );
    }
  });

const withGlobalErrorReporting = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
  return effect.pipe(
    Effect.tapErrorCause((cause) => 
      Effect.sync(() => {
        if (!Cause.isInterruptedOnly(cause)) {
          const failure = Cause.squash(cause);
          const message = failure instanceof Error ? failure.message : String(failure);
          console.error("[Runtime] Unhandled Effect Failure:", failure);
          addToast(`Unexpected Error: ${message.slice(0, 100)}`, "error", 6000);
        }
      })
    )
  );
};

export const runClientPromise = <A, E>(
  effect: Effect.Effect<A, E, FullClientContext>,
) => {
  return Runtime.runPromise(clientRuntime)(withGlobalErrorReporting(effect));
};

export const runClientUnscoped = <A, E>(
  effect: Effect.Effect<A, E, FullClientContext>,
) => {
  return Runtime.runFork(clientRuntime)(withGlobalErrorReporting(effect));
};

export const shutdownClient = () =>
  Effect.runPromise(Scope.close(appScope, Exit.succeed(undefined)));
