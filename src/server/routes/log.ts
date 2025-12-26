// FILE: src/server/routes/log.ts
import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { effectPlugin } from "../middleware/effect-plugin";

/**
 * Log Route
 * This endpoint receives log entries from the browser and re-emits them
 * into the server's Effect logging system.
 */
export const logRoutes = new Elysia({ prefix: "/api/log" })
  .use(effectPlugin)
  .post(
    "/",
    async ({ body, runEffect }) => {
      const { level, message, timestamp, data, url } = body;

      const serverLogLogic = Effect.gen(function* () {
        const logMessage = `[Browser] ${message}`;

        // Select the appropriate log effect based on the level string
        const logOperation = (() => {
          switch (level) {
            case "error":
              return Effect.logError(logMessage);
            case "warn":
              return Effect.logWarning(logMessage);
            case "debug":
              return Effect.logDebug(logMessage);
            case "info":
            default:
              return Effect.logInfo(logMessage);
          }
        })();

        // Apply annotations.
        yield* logOperation.pipe(
          Effect.annotateLogs("origin", "browser"),
          Effect.annotateLogs("clientTimestamp", timestamp),
          Effect.annotateLogs("clientUrl", url),
          Effect.annotateLogs("data", data),
        );
      });

      // We run this on the server runtime so it hits the OTLP collector
      return runEffect(serverLogLogic);
    },
    {
      body: t.Object({
        level: t.String(),
        message: t.String(),
        timestamp: t.String(),
        // ✅ FIX: Use t.Unknown() instead of t.Any() to avoid unsafe assignment lint errors
        data: t.Unknown(),
        url: t.String(),
      }),
    },
  );
