// FILE: src/lib/client/geolocation.ts
import { Effect } from "effect";
import { clientLog } from "./clientLog";
import { runClientUnscoped } from "./runtime";

export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy: number; // ✅ Added accuracy (meters)
}

export const getCurrentPosition = () =>
  Effect.async<GeoLocation | null, never>((resume) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resume(Effect.succeed(null));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy, // ✅ Capture accuracy
        };
        // Fire-and-forget log to avoid blocking the resume logic with async log overhead
        runClientUnscoped(clientLog("debug", "[Geolocation] Acquired", coords));
        resume(Effect.succeed(coords));
      },
      (error) => {
        runClientUnscoped(clientLog("warn", "[Geolocation] Failed or Denied", error.message));
        // Return null on error so the app flow continues without location
        resume(Effect.succeed(null));
      },
      {
        enableHighAccuracy: true,
        timeout: 5000, // Increased slightly to 5s to allow better GPS lock
        maximumAge: 60000, // Accept cached position up to 1 min old
      }
    );
  });
