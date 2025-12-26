// FILE: src/lib/client/api.ts
import { treaty } from "@elysiajs/eden";
import { Capacitor } from "@capacitor/core";
import type { App } from "../../server";

// The "Trojan Horse" Production URL. 
// Mobile apps will always talk to this, regardless of the user's specific tenant.
const PROD_ROOT_URL = "https://life-io.xyz"; 

const getBaseUrl = () => {
  // 1. Mobile App (Capacitor) -> Always force Root Production URL
  // This ensures the app doesn't try to talk to 'localhost' or a relative path in the WebView.
  if (Capacitor.isNativePlatform()) {
    // You can also use a specific VITE_MOBILE_API_URL env var if preferred later
    return PROD_ROOT_URL;
  }

  // 2. Browser Development -> Explicit Dev Server
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  // 3. Browser Production -> Relative URL (Same Origin)
  // This is crucial for Web: it allows the client to talk to 'app.life-io.xyz' 
  // without CORS issues, because the client is served from that same subdomain.
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  // ✅ FIX: Use 127.0.0.1 fallback for consistency to avoid localhost lookup failures
  return "http://127.0.0.1:42069";
};

export const api = treaty<App>(getBaseUrl());
