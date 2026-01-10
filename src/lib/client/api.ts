// File: src/lib/client/api.ts
// ------------------------
import { treaty } from "@elysiajs/eden";
import { Capacitor } from "@capacitor/core";
import type { App } from "../../server";

const getBaseUrl = () => {
  if (Capacitor.isNativePlatform()) return "https://life-io.xyz";
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  return window.location.origin;
};

/**
 * Gets the subdomain from the current hostname.
 * e.g., 'site-a.localhost' -> 'site-a'
 */
const getSubdomainHint = () => {
  if (typeof window === "undefined") return null;
  const hostname = window.location.hostname;
  const rootDomain = import.meta.env.VITE_ROOT_DOMAIN || "localhost";
  
  if (hostname === rootDomain || hostname === "127.0.0.1") return null;
  if (hostname.endsWith(`.${rootDomain}`)) {
    return hostname.replace(`.${rootDomain}`, "");
  }
  return null;
};

// Create the Eden Treaty client with automatic subdomain header injection
export const api = treaty<App>(getBaseUrl(), {
  headers: () => {
    const subdomain = getSubdomainHint();
    const token = localStorage.getItem("jwt");
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(subdomain ? { "X-Life-IO-Subdomain": subdomain } : {}),
    };
  }
});
