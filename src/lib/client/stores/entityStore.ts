// FILE: src/lib/client/stores/entityStore.ts
import { signal } from "@preact/signals-core";
import { Effect, Schema } from "effect";
import { TreeFormatter } from "effect/ParseResult";
import type { ReadonlyJSONValue } from "replicache";
import { ReplicacheService } from "../replicache";
import { EntitySchema, type AppEntity } from "../../shared/schemas";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../clientLog";

export const entityListState = signal<AppEntity[]>([]);

let _unsubscribe: (() => void) | undefined;

export const startEntitySubscription = () => {
  if (_unsubscribe) return;

  const effect = Effect.gen(function* () {
    const replicache = yield* ReplicacheService;
    yield* clientLog(
      "info",
      "[entityStore] Starting Replicache subscription.",
    );

    _unsubscribe = replicache.client.subscribe(
      async (tx) => {
        return await tx.scan({ prefix: "entity/" }).values().toArray();
      },
      (entityJSONs: ReadonlyJSONValue[]) => {
        const entities: AppEntity[] = [];
        let errorCount = 0;

        for (const json of entityJSONs) {
          const result = Schema.decodeUnknownEither(EntitySchema)(json);

          if (result._tag === "Right") {
            entities.push(result.right);
          } else {
            errorCount++;
            if (errorCount <= 3) {
              const errorStr = TreeFormatter.formatError(result.left);
              runClientUnscoped(
                clientLog("warn", "[entityStore] Validation Failed for entity:", {
                  jsonSummary: JSON.stringify(json).slice(0, 100),
                  error: errorStr,
                }),
              );
            }
          }
        }

        if (errorCount > 0) {
          runClientUnscoped(
            clientLog("warn", `[entityStore] Skipped ${errorCount} entities due to validation errors.`),
          );
        }

        // Sort by name alphabetically
        entities.sort((a, b) => a.name.localeCompare(b.name));

        runClientUnscoped(
          clientLog(
            "debug",
            `[entityStore] Update received. Valid entities: ${entities.length}`,
          ),
        );
        entityListState.value = entities;
      },
    );
  });

  runClientUnscoped(
    effect.pipe(
      Effect.catchAllCause((cause) =>
        clientLog(
          "error",
          "[entityStore] Failed to start subscription",
          cause,
        ),
      ),
    ),
  );
};

export const stopEntitySubscription = () => {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = undefined;
    entityListState.value = [];
    runClientUnscoped(
      clientLog("info", "[entityStore] Stopped Replicache subscription."),
    );
  }
};
