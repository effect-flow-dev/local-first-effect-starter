// FILE: src/lib/client/hlc/HlcService.ts
import { Context, Effect, Layer, SynchronizedRef } from "effect";
import { get, set, createStore } from "idb-keyval";
import { 
    type Hlc, 
    initHlc, 
    tickHlc, 
    receiveHlc, 
    packHlc, 
    unpackHlc 
} from "../../shared/hlc";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

/**
 * HlcService manages the Hybrid Logical Clock state on the client.
 * It persists the latest HLC to IndexedDB to survive page reloads.
 */
export interface IHlcService {
  /**
   * Ticks the clock forward and returns the packed HLC string.
   * Use this before creating any mutation.
   */
  readonly getNextHlc: () => Effect.Effect<string>;
  
  /**
   * Updates the local clock based on a timestamp received from the server.
   * Call this in the pull handler or when receiving a WebSocket message.
   */
  readonly updateFromRemote: (remotePacked: string) => Effect.Effect<void>;
  
  /**
   * Synchronous access for Replicache mutators.
   * Mutators must be synchronous, so they use the current in-memory value.
   */
  readonly getNextHlcSync: () => string;
}

export class HlcService extends Context.Tag("HlcService")<
  HlcService,
  IHlcService
>() {}

const DB_NAME = "life-io-db";
const STORE_NAME = "hlc-store";
const hlcIdbStore = createStore(DB_NAME, STORE_NAME);
const HLC_STORAGE_KEY = "current_hlc";

export const HlcLive = (userId: string) =>
  Layer.effect(
    HlcService,
    Effect.gen(function* () {
      yield* clientLog("info", "[HlcService] Initializing...");

      // 1. Load from Persistence
      const persistedHlcString = yield* Effect.tryPromise({
        try: () => get<string>(HLC_STORAGE_KEY, hlcIdbStore),
        catch: (e) => e,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)));

      let currentHlc: Hlc;

      if (persistedHlcString) {
        yield* clientLog("debug", "[HlcService] Found persisted HLC", persistedHlcString);
        // Ensure we advance against current physical time to prevent time-travel 
        // if the browser was closed for a while.
        currentHlc = receiveHlc(unpackHlc(persistedHlcString), persistedHlcString, Date.now());
      } else {
        yield* clientLog("info", "[HlcService] No persisted HLC found. Initializing new clock.");
        currentHlc = initHlc(userId);
      }

      // 2. State Management
      // We use a SynchronizedRef to ensure updates are atomic.
      const state = yield* SynchronizedRef.make(currentHlc);

      // We maintain a local variable for sync access in Replicache mutators
      let inMemoryValue = currentHlc;

      const persist = (hlc: Hlc) =>
        Effect.tryPromise({
          try: () => set(HLC_STORAGE_KEY, packHlc(hlc), hlcIdbStore),
          catch: (e) => {
            console.error("[HlcService] Failed to persist HLC to IndexedDB", e);
            return e;
          },
        }).pipe(Effect.catchAll(() => Effect.void));

      return {
        getNextHlc: () =>
          SynchronizedRef.updateAndGet(state, (local: Hlc) => {
            const next = tickHlc(local, Date.now());
            inMemoryValue = next;
            return next;
          }).pipe(
            Effect.tap((next: Hlc) => persist(next)),
            Effect.map(packHlc)
          ),

        updateFromRemote: (remotePacked: string) =>
          SynchronizedRef.update(state, (local: Hlc) => {
            const next = receiveHlc(local, remotePacked, Date.now());
            inMemoryValue = next;
            return next;
          }).pipe(
            Effect.flatMap(() => SynchronizedRef.get(state)),
            Effect.flatMap((next: Hlc) => persist(next))
          ),

        getNextHlcSync: () => {
          // Replicache Mutator usage:
          // We tick the in-memory value immediately so subsequent mutators 
          // in the same batch get unique timestamps.
          const next = tickHlc(inMemoryValue, Date.now());
          inMemoryValue = next;
          
          // Background persistence (Fire and Forget)
          runClientUnscoped(persist(next));
          
          return packHlc(next);
        },
      };
    })
  );
