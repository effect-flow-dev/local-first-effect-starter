// FILE: src/lib/server/push.ts
import webpush from "web-push";
import { Data, Effect } from "effect";
import { config } from "./Config";

export class PushError extends Data.TaggedError("PushError")<{
readonly cause: unknown;
readonly statusCode?: number;
}> {}

// Initialize globally with config secrets
try {
webpush.setVapidDetails(
config.vapid.subject,
config.vapid.publicKey,
config.vapid.privateKey
);
} catch (e) {
console.warn("[Push] Failed to set VAPID details. Push notifications will fail.", e);
}

export interface PushSubscriptionInput {
endpoint: string;
keys: {
p256dh: string;
auth: string;
};
}

/**

    Sends a web push notification.

    Wraps web-push library calls in an Effect for composability and error tracking.
    */
    export const sendPushNotification = (
    subscription: PushSubscriptionInput,
    payload: string | Buffer | Record<string, unknown>
    ) =>
    Effect.tryPromise({
    try: async () => {
    const content = typeof payload === "string" || Buffer.isBuffer(payload)
    ? payload
    : JSON.stringify(payload);

    return await webpush.sendNotification(subscription, content);
    },
    catch: (cause) => {
    let statusCode: number | undefined;
    // Extract status code from web-push error if available
    if (cause && typeof cause === 'object' && 'statusCode' in cause) {
    statusCode = (cause as { statusCode: number }).statusCode;
    }
    return new PushError({ cause, statusCode });
    },
    });
