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
  Schedule.exponential("1 second", 2.0).pipe(
    // Cap delay at 1 minute
    Schedule.map((d) => Duration.min(d, Duration.minutes(1))),
    // Add jitter
    Schedule.jittered,
    // Log and Persist Retry
    Schedule.tapInput((error) => 
      Effect.gen(function*() {
        // ✅ FIX: Only increment retry if it is a TransientUploadError.
        // Fatal errors stop the schedule via 'while' elsewhere, but tapInput might see them first.
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
      return; // Stop retrying, it's gone
    }

    if (item.status === "uploaded") {
      yield* clientLog("debug", `[MediaSync] Item ${uploadId} already uploaded.`);
      return; 
    }

    yield* updateMediaStatus(uploadId, "uploading");

    // ✅ FIX: Retrieve JWT for Authorization header
    const token = localStorage.getItem("jwt");
    if (!token) {
        // If we have no token, we can't upload. This is a transient error
        // because the user might log in later.
        return yield* Effect.fail(new TransientUploadError({ message: "No JWT token found" }));
    }

    // 1. Upload to API
    const response = yield* Effect.tryPromise(() =>
      api.api.media.upload.post(
        {
          file: item.file
        },
        // ✅ FIX: Add headers to the request options
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

      // Fatal Errors: 400 (Bad Request), 413 (Too Large), 415 (Type)
      if (status === 400 || status === 413 || status === 415) {
        return yield* Effect.fail(new FatalUploadError({ message: `Fatal (${status}): ${errorMsg}` }));
      }

      // Transient Errors: 401 (Auth might refresh), 500, 502, 503, 504, or Network
      // Note: 401 is treated as transient because the user might just need to re-login.
      return yield* Effect.fail(new TransientUploadError({ message: `Transient (${status}): ${errorMsg}` }));
    }

    if (!data || !('url' in data)) {
      return yield* Effect.fail(new TransientUploadError({ message: "Invalid response data from server" }));
    }

    const publicUrl = data.url;
    yield* clientLog("info", `[MediaSync] Uploaded to Cloud: ${publicUrl}`);

    // 2. Update Replicache (The Block)
    // We treat "Block Not Found" as Transient (sync lag). 
    // We retry this entire flow (including checking IDB) until the block appears.
    const currentVersion = yield* findBlockVersionInDB(replicache, item.blockId);

    const updated = yield* Effect.tryPromise(() =>
      replicache.client.mutate.updateBlock({
        // ✅ FIX: Use proper type cast (safe because we validated it implicitly)
        blockId: item.blockId as BlockId, 
        fields: {
          url: publicUrl,
          uploadId: null, 
        },
        version: currentVersion
      })
    );

    if (!updated) {
       // If updateBlock returns false, it means the blockId wasn't found in any note content.
       // This likely means the note sync hasn't arrived or the block was deleted.
       // We'll treat this as Transient for now (waiting for sync).
       return yield* Effect.fail(new TransientUploadError({ message: `Block ${item.blockId} not found in Replicache` }));
    }

    // Success!
    yield* clientLog("info", `[MediaSync] Block ${item.blockId} updated. Cleaning up.`);
    yield* removePendingMedia(uploadId);
  }).pipe(
    // Catch fetch network errors (which become UnknownException in tryPromise)
    Effect.catchAll((e) => {
      if (e instanceof FatalUploadError || e instanceof TransientUploadError) {
        return Effect.fail(e);
      }
      return Effect.fail(new TransientUploadError({ message: `Network/System Error: ${String(e)}` }));
    })
  );

const processUpload = (uploadId: string, replicache: IReplicacheService) =>
  performUploadAttempt(uploadId, replicache).pipe(
    Effect.retry({
      schedule: makeRetrySchedule(uploadId),
      while: (err) => err instanceof TransientUploadError
    }),
    Effect.catchTag("FatalUploadError", (err) => 
      Effect.gen(function*() {
        yield* clientLog("error", `[MediaSync] Fatal Error for ${uploadId}: ${err.message}`);
        yield* updateMediaStatus(uploadId, "error");
        // We do NOT remove from IDB, allowing manual intervention/inspection later
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
        { concurrency: 2 } // Limit concurrent uploads
      ),
      Stream.runDrain
    );

    yield* Effect.forkDaemon(pipeline);

    const resumePending = Effect.gen(function* () {
      const allItems = yield* getAllPendingMedia();
      let count = 0;
      for (const item of allItems) {
        // Resume anything not permanently failed or completed
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
