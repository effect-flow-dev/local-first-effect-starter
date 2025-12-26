// FILE: src/lib/server/server-runtime.ts
import { ManagedRuntime } from "effect";
import { ObservabilityLive } from "./observability";

// We create a specific layer for the server that includes Observability.
// In the future, we can add Database connection pooling layers here too
// if we want to share the pool via Context.
export const ServerLive = ObservabilityLive;

// We create a ManagedRuntime. This keeps the OpenTelemetry exporter alive
// and flushes metrics/traces periodically in the background.
// Using a standard Runtime.runPromise would spin up/tear down the exporter every request.
export const serverRuntime = ManagedRuntime.make(ServerLive);

