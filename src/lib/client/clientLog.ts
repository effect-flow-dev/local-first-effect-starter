// FILE: src/lib/client/clientLog.ts
import { Effect } from "effect";
import type { LogLevel } from "../shared/logConfig";
import { api } from "./api";

/**
 * clientLog is the primary logging utility for the frontend.
 * It logs locally to the browser console and forwards the log to the
 * backend server so that client and server logs can be viewed together
 * in the server's stdout/OTLP collector.
 */
export const clientLog = (
  level: Exclude<LogLevel, "silent">,
  ...args: unknown[]
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // 1. Log to the local browser console for the developer
    switch (level) {
      case "info":
        console.info(...args);
        break;
      case "warn":
        console.warn(...args);
        break;
      case "error":
        console.error(...args);
        break;
      case "debug":
        // Only log debug locally in dev mode to reduce noise
        if (import.meta.env.DEV) {
          console.debug(...args);
        }
        break;
    }

    // 2. Forward to the backend for unified logging
    // We do this in a "fire and forget" manner using Effect.runFork
    // to avoid blocking the UI logic on a network call for a log.
    const forwardEffect = Effect.gen(function* () {
      // Prepare payload
      const payload = {
        level,
        timestamp: new Date().toISOString(),
        // Try to extract a useful message if the first arg is a string, otherwise generic label
        message: typeof args[0] === "string" ? args[0] : "Client Log Event",
        // Pass all args as metadata (api expects 'data' to be Any)
        data: args.length > 1 ? args.slice(1) : args[0] ?? {},
        url: window.location.href,
      };

      // Use our Eden Treaty client to POST to /api/log.
      // We wrap in a try/catch block (Effect.tryPromise) that explicitly ignores errors
      // to prevent an infinite loop where a log failure tries to log an error, which fails, etc.
      yield* Effect.tryPromise({
        try: () => api.api.log.post(payload),
        catch: () => {
          // Intentionally silent on failure to avoid log-loops
          return undefined;
        },
      });
    });

    // Fork it so it runs in the background without blocking the current fiber
    yield* Effect.fork(forwardEffect);
  });
