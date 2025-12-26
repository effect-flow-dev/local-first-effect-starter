// FILE: src/lib/client/replicache/websocket.ts
import type { Replicache } from "replicache";
import { Effect, Schedule, Ref } from "effect";
import { Capacitor } from "@capacitor/core";
import { clientLog } from "../clientLog";
import type { ReplicacheMutators } from "../replicache";
import { runClientUnscoped } from "../../client/runtime";

const retryPolicy = Schedule.exponential(1000 /* 1 second base */).pipe(
  Schedule.jittered,
);

const getWsUrl = (): string => {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl && envUrl !== "undefined") {
    return `${envUrl}/ws`;
  }

  // ✅ FIX: Native mobile fallback.
  // Window location is local filesystem (capacitor://) on iOS, so relative WSS fails.
  if (Capacitor.isNativePlatform()) {
    return "wss://life-io.xyz/ws";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
};

export const setupWebSocket = (
  rep: Replicache<ReplicacheMutators>,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const token = localStorage.getItem("jwt");
    if (!token) {
      yield* clientLog("warn", "No JWT found for WebSocket connection. Skipping.");
      return;
    }

    const wsUrl = getWsUrl();
    const wsRef = yield* Ref.make<WebSocket | null>(null);

    const connectOnce = Effect.async<void, Error>((resume) => {
      runClientUnscoped(clientLog("info", `[WebSocket] Connecting to ${wsUrl}...`));
      
      const ws = new WebSocket(wsUrl, [token]);

      ws.onopen = () => {
        runClientUnscoped(clientLog("info", "[WebSocket] Connection opened."));
        void Effect.runSync(Ref.set(wsRef, ws));
        
        ws.onmessage = async (event) => {
          if (event.data === "poke") {
            runClientUnscoped(
              clientLog("info", "[WebSocket] Poke received. Triggering replicache.pull()"),
            );
            await rep.pull();
          } else {
             runClientUnscoped(clientLog("debug", "[WebSocket] Received unknown message", event.data));
          }
        };
      };

      ws.onerror = (event) => {
        runClientUnscoped(
          clientLog("error", "[WebSocket] Error event", { error: event }),
        );
      };

      ws.onclose = (event) => {
        runClientUnscoped(
          clientLog("warn", "[WebSocket] Connection closed.", {
            code: event.code,
            reason: event.reason,
          }),
        );
        resume(Effect.fail(new Error("WebSocket closed")));
      };
    });

    const connectionLoop = Effect.retry(connectOnce, retryPolicy);

    const finalizer = Effect.gen(function* () {
      yield* clientLog("info", "[WebSocket] Closing connection due to scope release.");
      const ws = yield* Ref.get(wsRef);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    });

    return yield* Effect.ensuring(connectionLoop, finalizer);
  });
