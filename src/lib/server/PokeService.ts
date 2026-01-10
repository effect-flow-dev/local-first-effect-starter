// FILE: src/lib/server/PokeService.ts
import { Effect, PubSub, Stream } from "effect";
import type { UserId } from "../shared/schemas"; // ✅ Fixed Import

// Maps UserId -> The User's personal message stream
const userPubSubs = new Map<UserId, PubSub.PubSub<string>>();

// Maps TenantId -> Set of UserIds currently connected to that tenant
export const tenantSessions = new Map<string, Set<UserId>>();

export const poke = (userId: UserId) =>
  Effect.gen(function* () {
    const userPubSub = userPubSubs.get(userId);
    if (userPubSub) {
      yield* PubSub.publish(userPubSub, "poke");
    }
  });

export const broadcastPresence = (tenantId: string, payload: Record<string, unknown>) =>
  Effect.gen(function* () {
    const users = tenantSessions.get(tenantId);
    if (!users) return;

    const message = JSON.stringify(payload);

    for (const userId of users) {
      const userPubSub = userPubSubs.get(userId);
      if (userPubSub) {
        yield* PubSub.publish(userPubSub, message);
      }
    }
  });

export const subscribe = (userId: UserId, tenantId: string | null) =>
  Stream.unwrap(
    Effect.gen(function* () {
      let userPubSub = userPubSubs.get(userId);
      
      if (!userPubSub) {
        userPubSub = yield* PubSub.unbounded<string>();
        userPubSubs.set(userId, userPubSub);
      }

      if (tenantId) {
        let sessions = tenantSessions.get(tenantId);
        if (!sessions) {
          sessions = new Set();
          tenantSessions.set(tenantId, sessions);
        }
        sessions.add(userId);
      }

      return Stream.fromPubSub(userPubSub).pipe(
        Stream.ensuring(
          Effect.sync(() => {
            if (tenantId) {
                const sessions = tenantSessions.get(tenantId);
                if (sessions) {
                    sessions.delete(userId);
                    if (sessions.size === 0) {
                        tenantSessions.delete(tenantId);
                    }
                }
            }
          })
        ),
      );
    }),
  );
