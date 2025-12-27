// FILE: src/lib/client/MapCacheService.ts
import { Effect } from "effect";
import { ReplicacheService } from "./replicache";
import { clientLog } from "./clientLog";
import { runClientUnscoped } from "./runtime";
import { getSurroundingTiles } from "./logic/tile-math";

// Cache to prevent re-fetching tiles we've already processed this session
const _processedTiles = new Set<string>();

const DEFAULT_PREFETCH_ZOOM = 15;
const PREFETCH_GRID_SIZE = 3; // 3x3 grid = 9 tiles per location

export const startMapPrefetch = () => {
  const effect = Effect.gen(function* () {
    const replicache = yield* ReplicacheService;

    // Subscribe to the blocksByGeo index.
    // This efficiently gives us all blocks that have location data.
    replicache.client.subscribe(
      async (tx) => {
        return await tx.scan({ indexName: "blocksByGeo" }).values().toArray();
      },
      {
        onData: (blocks) => {
          // 1. Identify needed tiles synchronously
          const urlsToFetch = new Set<string>();

          for (const b of blocks) {
            // Unsafe cast because the index ensures these fields exist, 
            // but the Replicache type is ReadonlyJSONValue.
            const block = b as { latitude?: number; longitude?: number };

            if (
              typeof block.latitude === "number" &&
              typeof block.longitude === "number"
            ) {
              const tiles = getSurroundingTiles(
                block.latitude,
                block.longitude,
                DEFAULT_PREFETCH_ZOOM,
                PREFETCH_GRID_SIZE,
              );

              for (const url of tiles) {
                if (!_processedTiles.has(url)) {
                  urlsToFetch.add(url);
                  _processedTiles.add(url);
                }
              }
            }
          }

          if (urlsToFetch.size === 0) return;

          runClientUnscoped(
            clientLog(
              "debug",
              `[MapCache] Found ${urlsToFetch.size} new tiles to prefetch.`,
            ),
          );

          // 2. Process in Batches
          const urlList = Array.from(urlsToFetch);
          const BATCH_SIZE = 10;

          const prefetchWorkflow = Effect.gen(function* () {
            for (let i = 0; i < urlList.length; i += BATCH_SIZE) {
              const batch = urlList.slice(i, i + BATCH_SIZE);

              yield* Effect.forEach(
                batch,
                (url) =>
                  Effect.tryPromise({
                    try: () =>
                      fetch(url, {
                        // "no-cors" is crucial for opaque responses (caching without reading)
                        mode: "no-cors",
                        priority: "low",
                      }),
                    // Swallow errors; caching is best-effort
                    catch: () => Promise.resolve(),
                  }),
                { concurrency: 5 }, // Moderate concurrency
              );

              // Yield to main thread
              yield* Effect.sleep("100 millis");
            }
          });

          runClientUnscoped(prefetchWorkflow);
        },
      },
    );
  });

  // Start the service in the background
  runClientUnscoped(
    effect.pipe(
      Effect.catchAll((err) =>
        clientLog("error", "[MapCache] Failed to start service", err),
      ),
    ),
  );
};
