// FILE: src/lib/client/MediaCacheService.ts
import { Effect } from "effect";
import { ReplicacheService } from "./replicache";
import { clientLog } from "./clientLog";
import { runClientUnscoped } from "./runtime";

// Module-level cache to deduplicate downloads across the session.
// This prevents re-downloading the same image if the subscription fires multiple times
// or if the user navigates away and back (SPA navigation).
const _processedCache = new Set<string>();

export const startMediaPrefetch = () => {
  const effect = Effect.gen(function* () {
    const replicache = yield* ReplicacheService;

    // Use the 'imagesByUrl' index defined in replicache.ts.
    // This provides a flat list of [url, blockId] tuples without loading full note content.
    // This is significantly faster than scanning "note/" and parsing JSON.
    replicache.client.subscribe(
      async (tx) => {
        // Returns: [[url, blockId], [url, blockId], ...] sorted by URL
        return await tx.scan({ indexName: "imagesByUrl" }).keys().toArray();
      },
      {
        onData: (keys) => {
          // 1. Filter new URLs synchronously
          // Iterate the keys (tuples) and extract the URL (first element).
          const newUrls = new Set<string>();
          
          for (const key of keys) {
            // Replicache index keys are [SecondaryKey, PrimaryKey] -> [Url, BlockId]
            const entry = key as [string, string];
            const url = entry[0];
            
            // Check validity and cache status
            if (url && typeof url === "string" && !_processedCache.has(url)) {
              if (url.startsWith("http")) {
                newUrls.add(url);
                // Mark as processed immediately to prevent duplicate queuing
                _processedCache.add(url);
              }
            }
          }

          if (newUrls.size === 0) return;

          runClientUnscoped(
            clientLog(
              "debug",
              `[MediaCache] Found ${newUrls.size} new media URLs to prefetch via Index.`,
            ),
          );

          // 2. Process in Batches (Time-Slicing)
          // We convert to an array and process in chunks to yield to the main thread.
          const urlList = Array.from(newUrls);
          const BATCH_SIZE = 50;

          const prefetchWorkflow = Effect.gen(function* () {
            for (let i = 0; i < urlList.length; i += BATCH_SIZE) {
              const batch = urlList.slice(i, i + BATCH_SIZE);

              // 3. Network Control (Traffic Fix)
              // We strictly limit concurrency to 4 to avoid starving Replicache sync packets
              // or blocking interaction on low-bandwidth connections.
              yield* Effect.forEach(
                batch,
                (url) =>
                  Effect.tryPromise({
                    try: () =>
                      fetch(url, {
                        // "no-cors" allows opacity (we don't need to read pixels, just cache)
                        // This allows caching images from 3rd party domains without strict CORS headers
                        mode: "no-cors",
                        // "low" priority hints the browser to prioritize other traffic (like API calls)
                        priority: "low",
                      }),
                    // Swallow errors to keep the batch going; caching is best-effort.
                    catch: () => Promise.resolve(),
                  }),
                { concurrency: 4 }, // ✅ Strict limit
              );

              // 4. Yield to the event loop
              // This ensures input handling and rendering can occur between batches
              yield* Effect.sleep("10 millis");
            }
          });

          // Run the workflow in the background
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
