// FILE: src/lib/client/replicache/fetchers.ts
import type { Puller, Pusher, PullerResult, PusherResult, PullResponse } from "replicache";
import { Capacitor } from "@capacitor/core";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../clientLog";
import { authState } from "../stores/authStore";

// ✅ FIX: Mobile apps cannot use relative URLs. Force absolute URL on Native.
const getApiBase = () => {
  if (Capacitor.isNativePlatform()) {
    // Replace with your actual production URL or a specific VITE_MOBILE_URL env var
    return "https://life-io.xyz"; 
  }
  return ""; // Browser handles relative paths fine
};

const API_BASE = getApiBase();

const resetLocalDatabase = async (userId: string) => {
  console.warn(
    "[Replicache] Wiping local database due to server state mismatch (Time Travel detected).",
  );

  const dbName = `rep:${userId}:7`; 

  try {
    window.indexedDB.deleteDatabase(dbName);

    if (window.indexedDB.databases) {
      const dbs = await window.indexedDB.databases();
      for (const db of dbs) {
        if (db.name && db.name.startsWith(`rep:${userId}`)) {
          console.warn(`[Replicache] Deleting found IDB: ${db.name}`);
          window.indexedDB.deleteDatabase(db.name);
        }
      }
    }
  } catch (e) {
    console.error("[Replicache] Failed to wipe database:", e);
  }

  window.location.reload();
};

export const puller: Puller = async (request): Promise<PullerResult> => {
  const token = localStorage.getItem("jwt");
  runClientUnscoped(
    clientLog("info", "[Replicache] Puller started", {
      cookie: request.cookie,
    }),
  );

  // ✅ FIX: Use absolute API_BASE and keepalive
  const response = await fetch(`${API_BASE}/api/replicache/pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
    // ✅ FIX: Critical for iOS background reliability
    keepalive: true, 
  });

  if (!response.ok) {
    runClientUnscoped(
      clientLog("error", "[Replicache] Puller failed", response.status),
    );
    throw new Error(`Pull failed: ${response.statusText}`);
  }

  const pullResponse = (await response.json()) as unknown as PullResponse & {
    error?: string;
  };

  if (pullResponse.error === "ClientStateNotFound") {
    runClientUnscoped(
      clientLog(
        "warn",
        "[Replicache] Server indicates ClientStateNotFound (Time Travel). Triggering Hard Reset.",
      ),
    );

    const userId = authState.value.user?.id;
    if (userId) {
      await resetLocalDatabase(userId);
    } else {
      window.location.reload();
    }

    return {
      response: undefined,
      httpRequestInfo: {
        httpStatusCode: 200,
        errorMessage: "ClientStateNotFound",
      },
    };
  }

  if ("patch" in pullResponse) {
    runClientUnscoped(
      clientLog("info", "[Replicache] Puller success", {
        patchCount: pullResponse.patch.length,
        nextCookie: pullResponse.cookie,
      }),
    );
  }

  return {
    response: pullResponse,
    httpRequestInfo: {
      httpStatusCode: response.status,
      errorMessage: "",
    },
  } as PullerResult;
};

export const pusher: Pusher = async (request): Promise<PusherResult> => {
  const token = localStorage.getItem("jwt");
  runClientUnscoped(
    clientLog("info", "[Replicache] Pusher started", {
      mutations: request.mutations.length,
    }),
  );

  // ✅ FIX: Use absolute API_BASE and keepalive
  const response = await fetch(`${API_BASE}/api/replicache/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
    // ✅ FIX: Critical for iOS background reliability
    keepalive: true,
  });

  if (!response.ok) {
    runClientUnscoped(
      clientLog("error", "[Replicache] Pusher failed", response.status),
    );
    throw new Error(`Push failed: ${response.statusText}`);
  }

  runClientUnscoped(clientLog("info", "[Replicache] Pusher success"));

  return {
    httpRequestInfo: {
      httpStatusCode: response.status,
      errorMessage: "",
    },
  };
};
