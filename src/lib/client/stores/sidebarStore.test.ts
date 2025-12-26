// FILE: src/lib/client/stores/sidebarStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sidebarState, toggleSidebar, initSidebarStore, closeSidebar } from "./sidebarStore";

// Mock localStorage
const localStorageMock = (function () {
  let store: Record<string, string> = {};
  return {
    getItem(key: string) {
      return store[key] || null;
    },
    setItem(key: string, value: string) {
      store[key] = value.toString();
    },
    clear() {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("sidebarStore", () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    localStorageMock.clear();
    // Reset signal
    sidebarState.value = true;
  });

  afterEach(() => {
    // Restore window width
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it("initializes to open (true) by default on desktop (>768px)", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1024,
    });
    initSidebarStore();
    expect(sidebarState.value).toBe(true);
  });

  it("initializes to closed (false) by default on mobile (<768px)", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 500,
    });
    initSidebarStore();
    expect(sidebarState.value).toBe(false);
  });

  it("initializes from localStorage if explicit preference exists (Desktop)", () => {
    Object.defineProperty(window, "innerWidth", { value: 1024 });
    localStorageMock.setItem("sidebar-open", "false");
    initSidebarStore();
    expect(sidebarState.value).toBe(false);
  });

  it("toggleSidebar switches state and updates localStorage", () => {
    Object.defineProperty(window, "innerWidth", { value: 1024 });
    initSidebarStore(); // Defaults to true

    toggleSidebar();
    expect(sidebarState.value).toBe(false);
    expect(localStorageMock.getItem("sidebar-open")).toBe("false");

    toggleSidebar();
    expect(sidebarState.value).toBe(true);
    expect(localStorageMock.getItem("sidebar-open")).toBe("true");
  });

  it("closeSidebar explicitly closes sidebar and persists state", () => {
    sidebarState.value = true;
    closeSidebar();
    expect(sidebarState.value).toBe(false);
    expect(localStorageMock.getItem("sidebar-open")).toBe("false");
  });
});
