// FILE: src/lib/server/observability.ts
import { Otlp } from "@effect/opentelemetry";
import { FetchHttpClient } from "@effect/platform";
import { Layer, Logger, LogLevel } from "effect";

/**
 * Parses the LOG_LEVEL string from the .env file into a LogLevel object.
 * Defaults to "Info" if the variable is missing or invalid.
 */
const getLogLevelFromEnv = (): LogLevel.LogLevel => {
  const level = process.env.LOG_LEVEL?.toLowerCase() ?? "info";
  switch (level) {
    case "debug":
      return LogLevel.Debug;
    case "warn":
      return LogLevel.Warning;
    case "error":
      return LogLevel.Error;
    case "info":
    default:
      return LogLevel.Info;
  }
};

// This layer will provide the OTLP logger, tracer, and metrics
const otlpProviderLayer = Otlp.layer({
  baseUrl: process.env.OTLP_BASE_URL!,
  resource: {
    serviceName: "life-io-backend",
    serviceVersion: "0.1.0",
  },
  loggerExportInterval: "1 second",
  tracerExportInterval: "5 seconds",
  metricsExportInterval: "10 seconds",
});

// This layer specifically sets the minimum log level for the entire application
const logLevelLayer = Logger.minimumLogLevel(getLogLevelFromEnv());

// We combine the OTLP provider and the log level setting into the final layer.
export const ObservabilityLive = otlpProviderLayer.pipe(
  // Provide the log level layer to the OTLP layer
  Layer.provide(logLevelLayer),
  // Provide the HTTP client that the OTLP layer needs to send data
  Layer.provide(FetchHttpClient.layer),
);
