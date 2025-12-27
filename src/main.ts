// FILE: src/main.ts
import { registerSW } from "virtual:pwa-register";
import { Capacitor } from "@capacitor/core";
import "./styles/index.css";
import "./components/layouts/app-shell.ts";
import {
  initializeAuthStore,
  proposeAuthAction,
} from "./lib/client/stores/authStore";
import { clientLog } from "./lib/client/clientLog";
import { runClientUnscoped } from "./lib/client/runtime";
// REMOVED: startMediaPrefetch import
import { initPWA } from "./lib/client/stores/pwaStore";

// --- 1. Persistent Storage Request (Critical for Offline Data) ---
async function requestPersistence() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    console.info(`[Storage] Persistent storage granted: ${isPersisted}`);
    if (!isPersisted) {
        console.warn("[Storage] WARNING: Data may be evicted by OS under low disk space.");
    }
  }
}
void requestPersistence();

// --- Tenant Hint Auto-Redirect (Web Only) ---
const rootDomain = import.meta.env.VITE_ROOT_DOMAIN || "localhost";
const currentHostname = window.location.hostname;

// Only run redirect logic if on Web Root Domain (not Native, not Subdomain)
if (!Capacitor.isNativePlatform() && (currentHostname === rootDomain || currentHostname === "127.0.0.1")) {
  const lastTenant = localStorage.getItem("last_visited_tenant");
  const urlParams = new URLSearchParams(window.location.search);
  const skipRedirect = urlParams.get("noredirect");

  if (lastTenant && !skipRedirect) {
    const protocol = window.location.protocol;
    const port = window.location.port ? `:${window.location.port}` : "";
    
    console.info(`[Main] Tenant hint found: ${lastTenant}. Redirecting...`);
    window.location.href = `${protocol}//${lastTenant}.${rootDomain}${port}/`;
  }
}

initPWA();

// --- Service Worker Registration ---
if (!Capacitor.isNativePlatform()) {
  registerSW({
    immediate: true,
    onRegistered(r: ServiceWorkerRegistration | undefined) {
      runClientUnscoped(
        clientLog("info", "[ServiceWorker] Registered successfully", {
          scope: r?.scope,
        }),
      );
    },
    onRegisterError(error: unknown) {
      runClientUnscoped(
        clientLog("error", "[ServiceWorker] Registration failed", error),
      );
    },
  });
}

// --- Token Handoff Logic ---
const urlParams = new URLSearchParams(window.location.search);
const handoffToken = urlParams.get("t");

if (handoffToken) {
  runClientUnscoped(
    clientLog("info", "[Main] Detected token in URL. Hydrating session..."),
  );
  localStorage.setItem("jwt", handoffToken);
  const newUrl = window.location.pathname;
  window.history.replaceState({}, document.title, newUrl);
}

initializeAuthStore();
// REMOVED: startMediaPrefetch(); -> Moved to runtime.ts

const token = localStorage.getItem("jwt");

if (!token) {
  void proposeAuthAction({ type: "SET_UNAUTHENTICATED" });
} else {
  void proposeAuthAction({ type: "AUTH_CHECK_START" });
}
