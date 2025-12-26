// FILE: src/lib/client/stores/noteListStore.ts
import { signal } from "@preact/signals-core";
import { Effect, Schema } from "effect";
import { TreeFormatter } from "effect/ParseResult";
import type { ReadonlyJSONValue } from "replicache";
import { ReplicacheService } from "../replicache";
import { NoteMetadataSchema, type AppNoteMetadata } from "../../shared/schemas";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../clientLog";

export const noteListState = signal<AppNoteMetadata[]>([]);

let _unsubscribe: (() => void) | undefined;

export const startNoteListSubscription = () => {
  if (_unsubscribe) return;

  const effect = Effect.gen(function* () {
    const replicache = yield* ReplicacheService;
    yield* clientLog(
      "info",
      "[noteListStore] Starting Replicache subscription.",
    );

    _unsubscribe = replicache.client.subscribe(
      async (tx) => {
        return await tx.scan({ prefix: "note/" }).values().toArray();
      },
      (noteJSONs: ReadonlyJSONValue[]) => {
        const notes: AppNoteMetadata[] = [];
        let errorCount = 0;
        
        for (const json of noteJSONs) {
          // Use decodeUnknownEither to safely attempt decoding so we can see the error
          const result = Schema.decodeUnknownEither(NoteMetadataSchema)(json);
          
          if (result._tag === "Right") {
            notes.push(result.right);
          } else {
            errorCount++;
            // Log the first few errors specifically to avoid spamming console
            if (errorCount <= 3) {
                const errorStr = TreeFormatter.formatError(result.left);
                runClientUnscoped(clientLog("warn", "[noteListStore] Schema Validation Failed for note:", { 
                    jsonSummary: JSON.stringify(json).slice(0, 100), 
                    error: errorStr 
                }));
            }
          }
        }

        if (errorCount > 0) {
             runClientUnscoped(clientLog("warn", `[noteListStore] Skipped ${errorCount} notes due to validation errors.`));
        }

        // Sort by updated_at descending
        notes.sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        );

        runClientUnscoped(clientLog("debug", `[noteListStore] Update received. Valid notes: ${notes.length}. Total source items: ${noteJSONs.length}`));
        noteListState.value = notes;
      },
    );
  });

  runClientUnscoped(
    effect.pipe(
      Effect.catchAllCause((cause) =>
        clientLog(
          "error",
          "[noteListStore] Failed to start subscription (Defect/Error)",
          cause,
        ),
      ),
    ),
  );
};

export const stopNoteListSubscription = () => {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = undefined;
    noteListState.value = [];
    runClientUnscoped(
      clientLog("info", "[noteListStore] Stopped Replicache subscription."),
    );
  }
};
