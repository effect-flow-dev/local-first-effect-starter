  // FILE: src/lib/client/stores/tabStore.ts
    import { signal } from "@preact/signals-core";
    import { clientLog } from "../clientLog";
    import { runClientUnscoped } from "../runtime";

    export interface Tab {
      id: string;
      title: string;
    }

    export const tabsState = signal<Tab[]>([]);
    export const activeTabIdState = signal<string | null>(null);

    export const openTab = (id: string) => {
      const currentTabs = tabsState.value;
      const existingTab = currentTabs.find((t) => t.id === id);

      runClientUnscoped(clientLog("debug", `[tabStore] openTab called for ${id}`, {
        existingFound: !!existingTab,
        currentCount: currentTabs.length,
        currentTabs: JSON.stringify(currentTabs),
      }));

      if (!existingTab) {
        // Add new tab with a placeholder title until data loads
        const newTabs = [...currentTabs, { id, title: "Loading..." }];
        runClientUnscoped(clientLog("debug", "[tabStore] Adding new tab. New count:", newTabs.length));
        tabsState.value = newTabs;
      } else {
        runClientUnscoped(clientLog("debug", "[tabStore] Tab already exists, switching to it."));
      }

      // Always switch to the requested tab
      if (activeTabIdState.value !== id) {
        runClientUnscoped(clientLog("debug", "[tabStore] Setting active tab to", id));
        activeTabIdState.value = id;
      }
    };

    export const updateTabTitle = (id: string, title: string) => {
      const currentTabs = tabsState.value;
      const tabIndex = currentTabs.findIndex((t) => t.id === id);
      const existingTab = currentTabs[tabIndex];

      if (tabIndex !== -1 && existingTab && existingTab.title !== title) {
        const newTabs = [...currentTabs];
        // Use non-null assertion since we verified index !== -1
        newTabs[tabIndex] = { ...existingTab, title };
        tabsState.value = newTabs;
      }
    };

    /**
     * Closes a tab and calculates the next route to navigate to.
     * Returns the path to navigate to, or null if no navigation is needed.
     */
    export const closeTab = (id: string): string | null => {
      const currentTabs = tabsState.value;
      const index = currentTabs.findIndex((t) => t.id === id);
      if (index === -1) return null;

      const newTabs = currentTabs.filter((t) => t.id !== id);
      tabsState.value = newTabs;

      // If we closed the currently active tab, we need to decide where to go
      if (activeTabIdState.value === id) {
        if (newTabs.length === 0) {
          activeTabIdState.value = null;
          return "/"; // Go home/list view if no tabs remain
        }

        // Logic: Go to the tab to the left, or the first one if we closed the first
        const nextTab = newTabs[index - 1] ?? newTabs[0];

        if (nextTab) {
          activeTabIdState.value = nextTab.id;
          return `/notes/${nextTab.id}`;
        } else {
          return "/";
        }
      }

      // If we closed a background tab, no navigation is needed
      return null;
    };

    /**
     * Resets the tab store state.
     * Useful on logout to prevent data leakage between sessions.
     */
    export const resetTabs = () => {
      tabsState.value = [];
      activeTabIdState.value = null;
      runClientUnscoped(clientLog("info", "[tabStore] Tabs reset."));
    };
