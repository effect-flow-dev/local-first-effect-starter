// FILE: src/lib/client/runtime.ts
import {
  Effect,
  Layer,
  Runtime,
  Scope,
  ExecutionStrategy,
  Exit,
  Cause
} from "effect";
import { clientLog } from "./clientLog";
import { LocationLive, LocationService } from "./LocationService";
import { ReplicacheLive, ReplicacheService } from "./replicache";
import { MediaSyncLive, MediaSyncService } from "./media/MediaSyncService";
import type { PublicUser } from "../shared/schemas";
import { addToast } from "./stores/toastStore";

// Base context only needs LocationService
export type BaseClientContext = LocationService;
// Full context includes Replicache AND MediaSync
export type FullClientContext = BaseClientContext | ReplicacheService | MediaSyncService;

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

    const replicacheLayer = ReplicacheLive(user);
    // MediaSync depends on Replicache, so we provide it here
    const mediaSyncLayer = MediaSyncLive.pipe(Layer.provide(replicacheLayer));
    
    // Merge authenticated layers
    const authenticatedLayer = Layer.merge(replicacheLayer, mediaSyncLayer);
    
    // Merge with base infrastructure
    const fullLayer = Layer.merge(BaseClientLive, authenticatedLayer);

    const newRuntime = yield* Scope.extend(
      Layer.toRuntime(fullLayer),
      newScope,
    );
    clientRuntime = newRuntime;

    yield* clientLog(
      "info",
      "<-- [runtime] Replicache & MediaSync runtimes activated successfully.",
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
      
      // Revert to the base runtime
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

/**
 * Wraps an Effect with global error reporting (Toast System).
 * If a fatal/unhandled error occurs in the chain, it pops a red toast.
 */
const withGlobalErrorReporting = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
  return effect.pipe(
    Effect.tapErrorCause((cause) => 
      Effect.sync(() => {
        // Only toast if it's not a controlled interruption (e.g. navigation cancellation)
        if (!Cause.isInterruptedOnly(cause)) {
          const failure = Cause.squash(cause);
          const message = failure instanceof Error ? failure.message : String(failure);
          
          console.error("[Runtime] Unhandled Effect Failure:", failure);
          
          // Trigger Global Toast
          addToast(
            `Unexpected Error: ${message.slice(0, 100)}`, 
            "error", 
            6000
          );
        }
      })
    )
  );
};

export const runClientPromise = <A, E>(
  effect: Effect.Effect<A, E, FullClientContext>,
) => {
  return Runtime.runPromise(clientRuntime)(
    withGlobalErrorReporting(effect)
  );
};

export const runClientUnscoped = <A, E>(
  effect: Effect.Effect<A, E, FullClientContext>,
) => {
  return Runtime.runFork(clientRuntime)(
    withGlobalErrorReporting(effect)
  );
};

export const shutdownClient = () =>
  Effect.runPromise(Scope.close(appScope, Exit.succeed(undefined)));
