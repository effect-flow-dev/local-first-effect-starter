// FILE: src/lib/client/media/MediaSyncService.ts
import { Context, Effect, Layer, Queue, Stream, Schema, Option, Schedule, Duration, Data } from "effect";
import {
  getAllPendingMedia,
  getPendingMedia,
  removePendingMedia,
  updateMediaStatus,
  incrementRetry,
} from "./mediaStore";
import { api } from "../api";
import { ReplicacheService } from "../replicache";
import type { IReplicacheService } from "../replicache";
import { clientLog } from "../clientLog";
import type { BlockId } from "../../shared/schemas";
import { NoteSchema } from "../../shared/schemas";

export interface IMediaSyncService {
  readonly queueUpload: (id: string) => Effect.Effect<void>;
}

export class MediaSyncService extends Context.Tag("MediaSyncService")<
  MediaSyncService,
  IMediaSyncService
>() {}

// --- Error Definitions ---

class FatalUploadError extends Data.TaggedError("FatalUploadError")<{
  readonly message: string;
}> {}

class TransientUploadError extends Data.TaggedError("TransientUploadError")<{
  readonly message: string;
}> {}

// --- Helpers ---

interface GenericNode {
  attrs?: {
    blockId?: string;
    version?: number;
    [key: string]: unknown;
  };
  content?: GenericNode[];
  [key: string]: unknown;
}

const findBlockVersionInDB = (
  replicache: IReplicacheService,
  blockId: string
) =>
  Effect.promise(async () => {
    const notes = await replicache.client.query((tx) =>
      tx.scan({ prefix: "note/" }).values().toArray()
    );

    for (const json of notes) {
      const note = Schema.decodeUnknownOption(NoteSchema)(json);
      if (Option.isNone(note)) continue;
      
      const content = note.value.content;
      if (!content || !content.content) continue;

      const traverse = (nodes: GenericNode[]): number | null => {
        for (const node of nodes) {
          if (node.attrs?.blockId === blockId) {
            return node.attrs.version ?? 1;
          }
          if (node.content && Array.isArray(node.content)) {
            const res = traverse(node.content);
            if (res) return res;
          }
        }
        return null;
      };

      const version = traverse(content.content as unknown as GenericNode[]);
      if (version) return version;
    }
    return 1;
  });

// --- Retry Policy ---

const makeRetrySchedule = (uploadId: string) => 
  Schedule.exponential("500 millis", 2.0).pipe(
    Schedule.map((d) => Duration.min(d, Duration.minutes(1))),
    Schedule.jittered,
    Schedule.tapInput((error) => 
      Effect.gen(function*() {
        if (error instanceof TransientUploadError) {
            const msg = error.message;
            yield* clientLog("warn", `[MediaSync] Retrying ${uploadId} after error: ${msg}`);
            yield* incrementRetry(uploadId, msg);
        }
      }).pipe(
        Effect.catchAll(() => Effect.void)
      )
    )
  );

// --- Core Logic ---

const performUploadAttempt = (uploadId: string, replicache: IReplicacheService) =>
  Effect.gen(function* () {
    const item = yield* getPendingMedia(uploadId);
    
    if (!item) {
      yield* clientLog("warn", `[MediaSync] Item ${uploadId} missing. Stopping.`);
      return; 
    }

    if (item.status === "uploaded") {
      yield* clientLog("debug", `[MediaSync] Item ${uploadId} already uploaded.`);
      return; 
    }

    yield* updateMediaStatus(uploadId, "uploading");

    const token = localStorage.getItem("jwt");
    if (!token) {
        return yield* Effect.fail(new TransientUploadError({ message: "No JWT token found" }));
    }

    // 1. Upload to API
    const response = yield* Effect.tryPromise(() =>
      api.api.media.upload.post(
        {
          file: item.file
        },
        {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
      )
    );

    const { data, error, status } = response;

    if (error) {
      const errorMsg =
        typeof error.value === "object" && error.value && "error" in error.value
          ? (error.value as { error: string }).error
          : `HTTP ${status}`;

      if (status === 400 || status === 413 || status === 415) {
        return yield* Effect.fail(new FatalUploadError({ message: `Fatal (${status}): ${errorMsg}` }));
      }
      return yield* Effect.fail(new TransientUploadError({ message: `Transient (${status}): ${errorMsg}` }));
    }

    if (!data || !('url' in data)) {
      return yield* Effect.fail(new TransientUploadError({ message: "Invalid response data from server" }));
    }

    const publicUrl = data.url;
    yield* clientLog("info", `[MediaSync] Uploaded to Cloud: ${publicUrl}`);

    // 2. Update Replicache (The Block)
    let currentVersion = 1;
    try {
        currentVersion = yield* findBlockVersionInDB(replicache, item.blockId);
    } catch (e) {
        yield* clientLog("error", `[MediaSync] Failed to find block version for ${item.blockId}`, e);
    }

    let updated = false;
    try {
        updated = yield* Effect.tryPromise({
            try: () =>
                replicache.client.mutate.updateBlock({
                    blockId: item.blockId as BlockId, 
                    fields: {
                    url: publicUrl,
                    uploadId: null, 
                    },
                    version: currentVersion
                }),
            catch: (e) => new TransientUploadError({ message: `Mutation Failed in TryPromise: ${String(e)}` })
        });
    } catch (e) {
        // Double catch for safety if tryPromise itself throws (rare)
        yield* clientLog("error", `[MediaSync] Replicache mutation exception`, e);
        return yield* Effect.fail(new TransientUploadError({ message: `Mutation Exception: ${String(e)}` }));
    }

    if (!updated) {
       const notes = yield* Effect.promise(() => replicache.client.query(tx => tx.scan({prefix: "note/"}).keys().toArray()));
       yield* clientLog("warn", `[MediaSync] UpdateBlock returned false for ${item.blockId}. Notes in DB: ${notes.length}`);
       
       return yield* Effect.fail(new TransientUploadError({ message: `Block ${item.blockId} not found in Replicache` }));
    }

    yield* clientLog("info", `[MediaSync] Block ${item.blockId} updated. Cleaning up.`);
    yield* removePendingMedia(uploadId);
  }).pipe(
    Effect.catchAll((e) => {
      if (e instanceof FatalUploadError || e instanceof TransientUploadError) {
        return Effect.fail(e);
      }
      // Log unexpected errors specifically
      return Effect.fail(new TransientUploadError({ message: `System Error: ${e instanceof Error ? e.message : String(e)}` }));
    })
  );

const processUpload = (uploadId: string, replicache: IReplicacheService) =>
  Effect.sleep("1500 millis").pipe(
    Effect.andThen(performUploadAttempt(uploadId, replicache)),
    Effect.retry({
      schedule: makeRetrySchedule(uploadId),
      while: (err) => err instanceof TransientUploadError
    }),
    Effect.catchTag("FatalUploadError", (err) => 
      Effect.gen(function*() {
        yield* clientLog("error", `[MediaSync] Fatal Error for ${uploadId}: ${err.message}`);
        yield* updateMediaStatus(uploadId, "error");
      })
    ),
    Effect.catchAll((err) => 
        clientLog("error", `[MediaSync] Unhandled error in processUpload loop`, err)
    )
  );

export const MediaSyncLive = Layer.effect(
  MediaSyncService,
  Effect.gen(function* () {
    const replicache = yield* ReplicacheService;
    const queue = yield* Queue.unbounded<string>();

    const pipeline = Stream.fromQueue(queue).pipe(
      Stream.mapEffect(
        (id) => processUpload(id, replicache),
        { concurrency: 2 } 
      ),
      Stream.runDrain
    );

    yield* Effect.forkDaemon(pipeline);

    const resumePending = Effect.gen(function* () {
      const allItems = yield* getAllPendingMedia();
      let count = 0;
      for (const item of allItems) {
        if (item.status !== "uploaded") {
          yield* Queue.offer(queue, item.id);
          count++;
        }
      }
      if (count > 0) {
        yield* clientLog("info", `[MediaSync] Resuming ${count} uploads from IDB.`);
      }
    });

    yield* Effect.forkDaemon(resumePending);

    return {
      queueUpload: (id: string) => Queue.offer(queue, id),
    };
  })
);
