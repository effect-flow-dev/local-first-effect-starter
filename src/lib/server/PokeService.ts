// FILE: src/lib/server/PokeService.ts
import { Effect, PubSub, Stream } from "effect";
import type { UserId } from "../../types/generated/public/User";

// Maps UserId -> The User's personal message stream
// Kept global to persist across HTTP requests in the server runtime
const userPubSubs = new Map<UserId, PubSub.PubSub<string>>();

// Maps TenantId -> Set of UserIds currently connected to that tenant
// Used for broadcasting messages to specific tenant scopes
export const tenantSessions = new Map<string, Set<UserId>>();

/**
 * Sends a "poke" (Replicache sync trigger) to a specific user.
 */
export const poke = (userId: UserId) =>
  Effect.gen(function* () {
    const userPubSub = userPubSubs.get(userId);
    if (userPubSub) {
      yield* PubSub.publish(userPubSub, "poke");
    }
  });

/**
 * Broadcasts a presence/ephemeral message to all users in a specific tenant.
 */
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

/**
 * Subscribes a user to their message stream and registers their session
 * within the context of a specific Tenant.
 * 
 * Returns a Stream that emits messages sent to this user.
 * When the stream is closed (connection drops), the cleanup logic removes the user from the tenant map.
 */
export const subscribe = (userId: UserId, tenantId: string | null) =>
  Stream.unwrap(
    Effect.gen(function* () {
      let userPubSub = userPubSubs.get(userId);
      
      if (!userPubSub) {
        // Create an unbounded PubSub for the user if one doesn't exist
        userPubSub = yield* PubSub.unbounded<string>();
        userPubSubs.set(userId, userPubSub);
      }

      // 1. Register session in Tenant map
      if (tenantId) {
        let sessions = tenantSessions.get(tenantId);
        if (!sessions) {
          sessions = new Set();
          tenantSessions.set(tenantId, sessions);
        }
        sessions.add(userId);
      }

      // 2. Return stream with cleanup hook
      return Stream.fromPubSub(userPubSub).pipe(
        Stream.ensuring(
          Effect.sync(() => {
            // 3. Cleanup on disconnect
            if (tenantId) {
                const sessions = tenantSessions.get(tenantId);
                if (sessions) {
                    sessions.delete(userId);
                    // If tenant is empty, remove the key to prevent memory leaks
                    if (sessions.size === 0) {
                        tenantSessions.delete(tenantId);
                    }
                }
            }
            // Note: We intentionally DO NOT delete userPubSub here.
            // In a real app, the user might reconnect quickly. 
            // Proper cleanup of userPubSubs would require a separate TTL or ref-counting mechanism.
          })
        ),
      );
    }),
  );
