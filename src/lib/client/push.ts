// FILE: src/lib/client/push.ts
import { Effect } from "effect";
import { clientLog } from "./clientLog";
import { api } from "./api";

// Helper to convert VAPID key from base64 string to Uint8Array
const urlBase64ToUint8Array = (base64String: string) => {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, "+")
        .replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
};

// Define minimal response interface to avoid 'any' propagation
interface PushResponse {
    data: unknown;
    error: unknown;
    status: number;
}

export const subscribeToPush = () =>
    Effect.gen(function* () {
        // 1. Feature Detection
        if (!("serviceWorker" in navigator)) {
            return yield* Effect.fail(new Error("Service Worker not supported"));
        }
        if (!("PushManager" in window)) {
            return yield* Effect.fail(new Error("Push API not supported"));
        }

        // 2. Permission Check
        let permission = Notification.permission;
        if (permission === "default") {
            yield* clientLog("info", "[Push] Requesting notification permission...");
            permission = yield* Effect.promise(() =>
                Notification.requestPermission(),
            );
        }

        if (permission !== "granted") {
            return yield* Effect.fail(new Error("Notification permission denied"));
        }

        // 3. Get Registration & Subscription
        const registration = yield* Effect.promise(
            () => navigator.serviceWorker.ready,
        );

        // Check if we need to subscribe or just update server
        let subscription = yield* Effect.promise(() =>
            registration.pushManager.getSubscription(),
        );

        if (!subscription) {
            const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
            if (!vapidKey) {
                return yield* Effect.fail(
                    new Error("Missing VITE_VAPID_PUBLIC_KEY configuration"),
                );
            }

            const convertedKey = urlBase64ToUint8Array(vapidKey);

            yield* clientLog(
                "info",
                "[Push] Creating new subscription with VAPID key.",
            );
            subscription = yield* Effect.promise(() =>
                registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: convertedKey,
                }),
            );
        } else {
            yield* clientLog("info", "[Push] Existing subscription found.");
        }

        // 4. Send to Server
        const subJson = subscription.toJSON();
        
        // Extract values to variables for type narrowing and to satisfy noUncheckedIndexedAccess
        const endpoint = subJson.endpoint;
        const p256dh = subJson.keys?.p256dh;
        const auth = subJson.keys?.auth;

        // Strict check ensuring all required fields are strings
        if (!endpoint || !p256dh || !auth) {
            return yield* Effect.fail(new Error("Invalid subscription data generated"));
        }

        const token = localStorage.getItem("jwt");
        if (!token) {
            return yield* Effect.fail(new Error("User not authenticated"));
        }

        yield* clientLog("debug", "[Push] Sending subscription to server...", {
            endpoint,
        });

        const response = yield* Effect.tryPromise(async () => {
            // Using standard fetch via Elysia client logic if type inference fails
            const res = await api.api.push.subscription.post(
                {
                    endpoint: endpoint,
                    keys: {
                        p256dh: p256dh,
                        auth: auth,
                    },
                },
                {
                    headers: { Authorization: `Bearer ${token}` },
                },
            );
            return res as PushResponse;
        });

        const r = response;

        if (r.error) {
            return yield* Effect.fail(
                new Error(`Server rejected subscription: ${r.status}`),
            );
        }

        yield* clientLog(
            "info",
            "[Push] Subscription active and synced with server.",
        );
    });
