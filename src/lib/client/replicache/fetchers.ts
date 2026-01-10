// File: src/lib/client/replicache/fetchers.ts
// ------------------------
import type { Puller, Pusher, PullerResult, PusherResult, PullResponse } from "replicache";
import { Capacitor } from "@capacitor/core";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../clientLog";
import { authState } from "../stores/authStore";

const getApiBase = () => {
  if (Capacitor.isNativePlatform()) return "https://life-io.xyz";
  return ""; 
};

/**
 * RESTORED: Logic to wipe IndexedDB if the server and client cookies
 * are completely out of sync (e.g. database was wiped/restored).
 */
const resetLocalDatabase = async (userId: string) => {
  runClientUnscoped(clientLog("warn", "[Replicache] Wiping local database due to ClientStateNotFound."));
  const dbName = `rep:${userId}:7`; 
  try {
    window.indexedDB.deleteDatabase(dbName);
    if (window.indexedDB.databases) {
      const dbs = await window.indexedDB.databases();
      for (const db of dbs) {
        if (db.name?.startsWith(`rep:${userId}`)) {
          window.indexedDB.deleteDatabase(db.name);
        }
      }
    }
  } catch (e) {
    console.error("[Replicache] Failed to wipe database:", e);
  }
  window.location.reload();
};

const getHeaders = () => {
  const token = localStorage.getItem("jwt");
  const hostname = window.location.hostname;
  const rootDomain = import.meta.env.VITE_ROOT_DOMAIN || "localhost";
  
  const subdomain = hostname.endsWith(`.${rootDomain}`) 
    ? hostname.replace(`.${rootDomain}`, "") 
    : null;

  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(subdomain ? { "X-Life-IO-Subdomain": subdomain } : {}),
  };
};

export const puller: Puller = async (request): Promise<PullerResult> => {
  runClientUnscoped(clientLog("info", "[Replicache] Puller started", { cookie: request.cookie }));

  const response = await fetch(`${getApiBase()}/api/replicache/pull`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(request),
    keepalive: true, // Preserve for mobile background reliability
  });

  if (!response.ok) {
    runClientUnscoped(clientLog("error", "[Replicache] Puller failed", response.status));
    throw new Error(`Pull failed: ${response.status}`);
  }

  const pullResponse = (await response.json()) as PullResponse & { error?: string };

  // RESTORED: Hard reset logic
  if (pullResponse.error === "ClientStateNotFound") {
    const userId = authState.value.user?.id;
    if (userId) await resetLocalDatabase(userId);
    else window.location.reload();

    return {
      response: undefined,
      httpRequestInfo: { httpStatusCode: 200, errorMessage: "ClientStateNotFound" },
    };
  }

  return {
    response: pullResponse,
    httpRequestInfo: { httpStatusCode: response.status, errorMessage: "" },
  } as PullerResult;
};

export const pusher: Pusher = async (request): Promise<PusherResult> => {
  runClientUnscoped(clientLog("info", "[Replicache] Pusher started", { count: request.mutations.length }));

  const response = await fetch(`${getApiBase()}/api/replicache/push`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(request),
    keepalive: true,
  });

  return { httpRequestInfo: { httpStatusCode: response.status, errorMessage: "" } };
};
