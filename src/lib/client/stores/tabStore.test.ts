// FILE: src/lib/client/stores/tabStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  tabsState,
  activeTabIdState,
  openTab,
  closeTab,
  updateTabTitle,
} from "./tabStore";

describe("tabStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    tabsState.value = [];
    activeTabIdState.value = null;
  });

  describe("openTab", () => {
    it("adds a new tab and sets it as active", () => {
      openTab("note-1");
      expect(tabsState.value).toHaveLength(1);
      expect(tabsState.value[0]!.title).toBe("Loading...");
      expect(tabsState.value[0]!.id).toBe("note-1");
      expect(activeTabIdState.value).toBe("note-1");
    });

    it("does not duplicate existing tabs, just sets active", () => {
      openTab("note-1");
      updateTabTitle("note-1", "My Note");
      openTab("note-1"); // Call again

      expect(tabsState.value).toHaveLength(1);
      // Use ! to assert existence for tests
      expect(tabsState.value[0]!.title).toBe("My Note");
      expect(activeTabIdState.value).toBe("note-1");
    });

    it("switches active tab when opening a different one", () => {
      openTab("note-1");
      openTab("note-2");

      expect(tabsState.value).toHaveLength(2);
      expect(activeTabIdState.value).toBe("note-2");
    });
  });

  describe("updateTabTitle", () => {
    it("updates the title of an existing tab", () => {
      openTab("note-1");
      updateTabTitle("note-1", "New Title");

      expect(tabsState.value[0]!).toEqual({ id: "note-1", title: "New Title" });
    });

    it("does nothing if tab does not exist", () => {
      updateTabTitle("non-existent", "Title");
      expect(tabsState.value).toHaveLength(0);
    });
  });

  describe("closeTab", () => {
    it("removes the tab from the list", () => {
      openTab("note-1");
      openTab("note-2");

      closeTab("note-1");

      expect(tabsState.value).toHaveLength(1);
      expect(tabsState.value[0]!.id).toBe("note-2");
    });

    it("returns null if closing a background tab (active tab remains unchanged)", () => {
      openTab("note-1");
      openTab("note-2"); // Active is note-2

      const nextPath = closeTab("note-1");

      expect(nextPath).toBeNull();
      expect(activeTabIdState.value).toBe("note-2");
    });

    it("activates the left neighbor when closing the active tab", () => {
      openTab("note-1");
      openTab("note-2");
      openTab("note-3"); // Active is note-3, list: [1, 2, 3]

      const nextPath = closeTab("note-3");

      expect(activeTabIdState.value).toBe("note-2");
      expect(nextPath).toBe("/notes/note-2");
    });

    it("activates the first tab if the first (and active) tab is closed", () => {
      openTab("note-1"); // Active is note-1
      openTab("note-2");
      // Switch back to 1 to make it active and first in list
      openTab("note-1"); // List is [1, 2], Active is 1

      const nextPath = closeTab("note-1");

      expect(activeTabIdState.value).toBe("note-2");
      expect(nextPath).toBe("/notes/note-2");
    });

    it("returns to home ('/') when closing the last remaining tab", () => {
      openTab("note-1");

      const nextPath = closeTab("note-1");

      expect(tabsState.value).toHaveLength(0);
      expect(activeTabIdState.value).toBeNull();
      expect(nextPath).toBe("/");
    });
  });
});
