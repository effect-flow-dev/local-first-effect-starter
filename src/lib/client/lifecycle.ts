// FILE: src/lib/client/lifecycle.ts
import { Chunk, Stream, Effect } from "effect";
import { authState, type AuthModel } from "./stores/authStore";
import { clientLog } from "./clientLog";
import { LocationService } from "./LocationService";
import {
  activateReplicacheRuntime,
  deactivateReplicacheRuntime,
} from "./runtime";
import {
  startNoteListSubscription,
  stopNoteListSubscription,
} from "./stores/noteListStore";
import {
  startNotebookSubscription,
  stopNotebookSubscription,
} from "./stores/notebookStore";
import {
  startEntitySubscription,
  stopEntitySubscription,
} from "./stores/entityStore"; // ✅ Added
import { resetTabs } from "./stores/tabStore";

// Raw stream of auth state changes from the signal
export const authStream: Stream.Stream<AuthModel, Error> =
  Stream.async<AuthModel>((emit) => {
    void emit(Effect.succeed(Chunk.of(authState.value)));
    const unsubscribe = authState.subscribe((value) => {
      void emit(Effect.succeed(Chunk.of(value)));
    });
    return Effect.sync(() => unsubscribe());
  }).pipe(
    Stream.tap((value) =>
      clientLog("debug", `[lifecycle] RAW authStream EMIT`, {
        status: value.status,
        userId: value.user?.id,
      }),
    ),
    Stream.changesWith(
      (a, b) => a.status === b.status && a.user?.id === b.user?.id,
    ),
  );

const coordinatedAuthStream = authStream.pipe(
  Stream.mapEffect(
    (auth) =>
      Effect.gen(function* () {
        if (auth.status === "authenticated") {
          yield* clientLog(
            "info",
            "[coordinator] Auth state is AUTHENTICATED. Activating runtime...",
          );
          yield* activateReplicacheRuntime(auth.user!);
          yield* clientLog(
            "info",
            "[coordinator] Runtime is ACTIVE. Starting subscriptions...",
          );
          startNoteListSubscription();
          startNotebookSubscription();
          startEntitySubscription(); // ✅ Start Entity Sync
        } else if (auth.status === "unauthenticated") {
          yield* clientLog(
            "info",
            "[coordinator] Auth state is UNAUTHENTICATED. Deactivating runtime...",
          );
          stopNoteListSubscription();
          stopNotebookSubscription();
          stopEntitySubscription(); // ✅ Stop Entity Sync
          
          resetTabs();
          
          yield* deactivateReplicacheRuntime();
          yield* clientLog(
            "info",
            "[coordinator] Runtime is INACTIVE. Emitting ready state.",
          );
        }
        return auth;
      }),
    { concurrency: 1 },
  ),
);

// The main application state stream
export const appStateStream: Stream.Stream<
  { path: string; auth: AuthModel },
  Error,
  LocationService
> = Stream.unwrap(
  Effect.gen(function* () {
    const location = yield* LocationService;
    return Stream.zipLatest(location.pathname, coordinatedAuthStream);
  }),
).pipe(
  // Map the tuple [path, auth] to an object
  Stream.map(([path, auth]) => ({ path, auth })),
  Stream.tap((state) =>
    clientLog("info", `[lifecycle] New COORDINATED app state emitted`, {
      path: state.path,
      authStatus: state.auth.status,
      userId: state.auth.user?.id,
    }),
  ),
);
