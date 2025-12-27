// FILE: src/lib/client/replicache/websocket.ts
import type { Replicache } from "replicache";
import { Effect, Schedule, Ref } from "effect";
import { Capacitor } from "@capacitor/core";
import { clientLog } from "../clientLog";
import type { ReplicacheMutators } from "../replicache";
import { runClientUnscoped } from "../../client/runtime";
import { updatePresence } from "../stores/presenceStore";

const retryPolicy = Schedule.exponential(1000 /* 1 second base */).pipe(
  Schedule.jittered,
);

let activeSocket: WebSocket | null = null;

/**
 * Sends a focus event to the server to indicate the user is looking at a specific block.
 * This is used for real-time presence indicators.
 */
export const sendFocus = (blockId: string) => {
  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    // Fire and forget - no reliability guarantees needed for ephemeral presence
    activeSocket.send(JSON.stringify({ type: "focus", blockId }));
  }
};

const getWsUrl = (): string => {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl && envUrl !== "undefined") {
    return `${envUrl}/ws`;
  }

  if (Capacitor.isNativePlatform()) {
    return "wss://life-io.xyz/ws";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
};

// Define expected message structure
interface PresenceMessage {
  type: "presence";
  blockId: string;
  userId: string;
}

// Type guard to safely check message structure
const isPresenceMessage = (data: unknown): data is PresenceMessage => {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).type === "presence" &&
    typeof (data as Record<string, unknown>).blockId === "string" &&
    typeof (data as Record<string, unknown>).userId === "string"
  );
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
        activeSocket = ws;
        
        ws.onmessage = async (event: MessageEvent) => {
          if (event.data === "poke") {
            runClientUnscoped(
              clientLog("info", "[WebSocket] Poke received. Triggering replicache.pull()"),
            );
            await rep.pull();
          } else {
             // Handle structured JSON messages (Presence, etc.)
             try {
                // Ensure data is treated as string for parsing
                const rawData = typeof event.data === "string" 
                    ? event.data 
                    : String(event.data);
                
                const msg: unknown = JSON.parse(rawData);
                
                if (isPresenceMessage(msg)) {
                    updatePresence(msg.blockId, msg.userId);
                } else {
                    runClientUnscoped(clientLog("debug", "[WebSocket] Received unknown JSON message", msg));
                }
             } catch {
                // Not JSON, and not 'poke'.
                runClientUnscoped(clientLog("debug", "[WebSocket] Received non-JSON message", event.data));
             }
          }
        };
      };

      ws.onerror = (event: Event) => {
        runClientUnscoped(
          clientLog("error", "[WebSocket] Error event", { error: event }),
        );
      };

      ws.onclose = (event: CloseEvent) => {
        runClientUnscoped(
          clientLog("warn", "[WebSocket] Connection closed.", {
            code: event.code,
            reason: event.reason,
          }),
        );
        if (activeSocket === ws) {
            activeSocket = null;
        }
        resume(Effect.fail(new Error("WebSocket closed")));
      };
    });

    const connectionLoop = Effect.retry(connectOnce, retryPolicy);

    const finalizer = Effect.gen(function* () {
      yield* clientLog("info", "[WebSocket] Closing connection due to scope release.");
      const ws = yield* Ref.get(wsRef);
      if (ws) {
        if (activeSocket === ws) activeSocket = null;
        ws.onclose = null;
        ws.close();
      }
    });

    return yield* Effect.ensuring(connectionLoop, finalizer);
  });
