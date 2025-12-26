// FILE: src/lib/server/PokeService.ts
import { Effect, PubSub, Stream } from "effect";
import type { UserId } from "../../types/generated/public/User";

// Global map to hold active PubSubs for connected users
// We use PubSub<string> where the string is the "poke" message
const userPubSubs = new Map<UserId, PubSub.PubSub<string>>();

export const poke = (userId: UserId) =>
  Effect.gen(function* () {
    const userPubSub = userPubSubs.get(userId);
    if (userPubSub) {
      yield* PubSub.publish(userPubSub, "poke");
    }
  });

export const subscribe = (userId: UserId) =>
  Stream.unwrap(
    Effect.gen(function* () {
      let userPubSub = userPubSubs.get(userId);
      
      if (!userPubSub) {
        // Create an unbounded PubSub for the user
        userPubSub = yield* PubSub.unbounded<string>();
        userPubSubs.set(userId, userPubSub);
      }

      return Stream.fromPubSub(userPubSub).pipe(
        Stream.ensuring(
          Effect.logInfo(`WebSocket stream for user ${userId} ended/interrupted.`)
        ),
      );
    }),
  );
