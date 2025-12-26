// FILE: src/lib/client/stores/sidebarStore.ts
import { signal } from "@preact/signals-core";

const STORAGE_KEY = "sidebar-open";

// Initialize state from local storage, defaulting to true on desktop, false on mobile
const getInitialState = (): boolean => {
  if (typeof window !== "undefined" && window.innerWidth < 768) {
    return false;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === "true";
};

export const sidebarState = signal<boolean>(getInitialState());

export const initSidebarStore = () => {
  // Ensure the signal matches current local storage on init (mostly for tests/resets)
  sidebarState.value = getInitialState();
};

export const toggleSidebar = () => {
  const newState = !sidebarState.value;
  sidebarState.value = newState;
  localStorage.setItem(STORAGE_KEY, String(newState));
};

export const closeSidebar = () => {
  sidebarState.value = false;
  localStorage.setItem(STORAGE_KEY, "false");
};
