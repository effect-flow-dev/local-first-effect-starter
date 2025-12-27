// FILE: src/lib/client/stores/presenceStore.ts
import { signal } from "@preact/signals-core";

export interface PresenceUser {
  userId: string;
  color: string;
  lastActive: number;
}

export type PresenceState = Record<string, PresenceUser[]>;

export const presenceState = signal<PresenceState>({});

// Deterministic color generation based on userId string
const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  return "#" + "00000".substring(0, 6 - c.length) + c;
};

export const updatePresence = (blockId: string, userId: string) => {
  const now = Date.now();
  const current = presenceState.value;
  const blockUsers = current[blockId] || [];

  // Remove existing entry for this user to update timestamp
  const otherUsers = blockUsers.filter((u) => u.userId !== userId);
  
  const newUser: PresenceUser = {
    userId,
    color: stringToColor(userId),
    lastActive: now,
  };

  presenceState.value = {
    ...current,
    [blockId]: [...otherUsers, newUser],
  };
};

/**
 * Cleanup logic extracted for testing visibility.
 * Removes users who haven't sent a heartbeat in the last 30 seconds.
 */
export const cleanupPresence = () => {
  const now = Date.now();
  const current = presenceState.value;
  let changed = false;
  const nextState: PresenceState = {};

  for (const [blockId, users] of Object.entries(current)) {
    // Keep users active within last 30 seconds
    const activeUsers = users.filter((u) => now - u.lastActive < 30000);
    
    if (activeUsers.length !== users.length) {
      changed = true;
    }
    
    if (activeUsers.length > 0) {
      nextState[blockId] = activeUsers;
    } else {
      // If all users timed out for this block, drop the key
      changed = true;
    }
  }

  if (changed) {
    presenceState.value = nextState;
  }
};

/**
 * Self-Cleaning Loop
 * Runs every 5 seconds to remove stale users.
 */
setInterval(cleanupPresence, 5000);
