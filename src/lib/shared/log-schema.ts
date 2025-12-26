// src/log-schema.ts
import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import type { LogLevel } from "./logConfig";

const isLoggableLevel = (l: unknown): l is Exclude<LogLevel, "silent"> =>
  typeof l === "string" && ["info", "error", "warn", "debug"].includes(l);

export const RpcLog = RpcGroup.make(
  Rpc.make("log", {
    success: Schema.Void,
    payload: {
      level: Schema.String.pipe(Schema.filter(isLoggableLevel)),
      args: Schema.Array(Schema.Unknown),
    },
  }),
);
