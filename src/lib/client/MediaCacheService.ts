// FILE: src/lib/client/MediaCacheService.ts
import { Effect } from "effect";
import { ReplicacheService } from "./replicache";
import { clientLog } from "./clientLog";
import { runClientUnscoped } from "./runtime";

// Module-level cache to deduplicate downloads across the session.
const _processedCache = new Set<string>();

// Threshold for auto-downloading non-image files (5MB)
const FILE_AUTO_DOWNLOAD_LIMIT = 5 * 1024 * 1024;

interface BlockWithUrl {
  id: string;
  type: string;
  fields: {
    url?: string;
    size?: number;
    mimeType?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ✅ FIX: Use 'unknown' instead of 'ReadonlyJSONValue' to avoid TS2677.
// This allows the type guard to narrow ANY value down to our specific BlockWithUrl interface.
const isBlockWithUrl = (val: unknown): val is BlockWithUrl => {
  if (typeof val !== "object" || val === null) return false;
  const b = val as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    typeof b.type === "string" &&
    typeof b.fields === "object" &&
    b.fields !== null &&
    typeof (b.fields as Record<string, unknown>).url === "string"
  );
};

export const startMediaPrefetch = () => {
  const effect = Effect.gen(function* () {
    const replicache = yield* ReplicacheService;

    // We scan the 'imagesByUrl' index.
    // Previously we only scanned keys, now we scan values (full blocks) to inspect metadata (size/type).
    replicache.client.subscribe(
      async (tx) => {
        return await tx.scan({ indexName: "imagesByUrl" }).values().toArray();
      },
      {
        onData: (blocks) => {
          // 1. Identify needed URLs synchronously
          const urlsToFetch = new Set<string>();

          for (const block of blocks) {
            if (!isBlockWithUrl(block)) continue;

            const url = block.fields.url;
            if (!url || !url.startsWith("http")) continue;
            if (_processedCache.has(url)) continue;

            // ✅ Logic: Selective Prefetching
            let shouldFetch = false;

            if (block.type === "image") {
              // Always prefetch images for instant UI
              shouldFetch = true;
            } else if (block.type === "file_attachment") {
              // Check size for files
              const size = block.fields.size;
              if (typeof size === "number" && size <= FILE_AUTO_DOWNLOAD_LIMIT) {
                shouldFetch = true;
              } else if (typeof size === "number") {
                // Log skip for debugging (verbose only)
                if (import.meta.env.DEV) {
                    console.debug(`[MediaCache] Skipping large file prefetch: ${size} bytes`);
                }
              } else {
                // If size is unknown/missing, fetch to ensure availability
                shouldFetch = true;
              }
            }

            if (shouldFetch) {
              urlsToFetch.add(url);
              _processedCache.add(url);
            }
          }

          if (urlsToFetch.size === 0) return;

          runClientUnscoped(
            clientLog(
              "debug",
              `[MediaCache] Found ${urlsToFetch.size} new items to prefetch.`,
            ),
          );

          // 2. Process in Batches
          const urlList = Array.from(urlsToFetch);
          const BATCH_SIZE = 50;

          const prefetchWorkflow = Effect.gen(function* () {
            for (let i = 0; i < urlList.length; i += BATCH_SIZE) {
              const batch = urlList.slice(i, i + BATCH_SIZE);

              // 3. Network Control
              yield* Effect.forEach(
                batch,
                (url) =>
                  Effect.tryPromise({
                    try: () =>
                      fetch(url, {
                        mode: "no-cors",
                        priority: "low",
                      }),
                    catch: () => Promise.resolve(),
                  }),
                { concurrency: 4 },
              );

              yield* Effect.sleep("10 millis");
            }
          });

          runClientUnscoped(prefetchWorkflow);
        },
      },
    );
  });

  runClientUnscoped(
    effect.pipe(
      Effect.catchAll((err) =>
        clientLog("error", "[MediaCache] Failed to start service", err),
      ),
    ),
  );
};
