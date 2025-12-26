// FILE: src/lib/client/stores/notebookStore.ts
import { signal } from "@preact/signals-core";
import { Effect, Schema } from "effect";
import { TreeFormatter } from "effect/ParseResult";
import type { ReadonlyJSONValue } from "replicache";
import { ReplicacheService } from "../replicache";
import { NotebookSchema, type AppNotebook } from "../../shared/schemas";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../clientLog";

export const notebookListState = signal<AppNotebook[]>([]);

let _unsubscribe: (() => void) | undefined;

export const startNotebookSubscription = () => {
  if (_unsubscribe) return;

  const effect = Effect.gen(function* () {
    const replicache = yield* ReplicacheService;
    yield* clientLog(
      "info",
      "[notebookStore] Starting Replicache subscription.",
    );

    _unsubscribe = replicache.client.subscribe(
      async (tx) => {
        return await tx.scan({ prefix: "notebook/" }).values().toArray();
      },
      (notebookJSONs: ReadonlyJSONValue[]) => {
        const notebooks: AppNotebook[] = [];
        let errorCount = 0;

        for (const json of notebookJSONs) {
          const result = Schema.decodeUnknownEither(NotebookSchema)(json);

          if (result._tag === "Right") {
            notebooks.push(result.right);
          } else {
            errorCount++;
            if (errorCount <= 3) {
              const errorStr = TreeFormatter.formatError(result.left);
              runClientUnscoped(
                clientLog("warn", "[notebookStore] Validation Failed for notebook:", {
                  jsonSummary: JSON.stringify(json).slice(0, 100),
                  error: errorStr,
                }),
              );
            }
          }
        }

        if (errorCount > 0) {
          runClientUnscoped(
            clientLog("warn", `[notebookStore] Skipped ${errorCount} notebooks due to validation errors.`),
          );
        }

        // Sort by created_at (oldest first) or name
        notebooks.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );

        runClientUnscoped(
          clientLog(
            "debug",
            `[notebookStore] Update received. Valid notebooks: ${notebooks.length}`,
          ),
        );
        notebookListState.value = notebooks;
      },
    );
  });

  runClientUnscoped(
    effect.pipe(
      Effect.catchAllCause((cause) =>
        clientLog(
          "error",
          "[notebookStore] Failed to start subscription",
          cause,
        ),
      ),
    ),
  );
};

export const stopNotebookSubscription = () => {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = undefined;
    notebookListState.value = [];
    runClientUnscoped(
      clientLog("info", "[notebookStore] Stopped Replicache subscription."),
    );
  }
};
