// FILE: src/components/layouts/Sidebar.test.ts
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { Sidebar } from "./Sidebar";
import { noteListState } from "../../lib/client/stores/noteListStore";
import { sidebarState } from "../../lib/client/stores/sidebarStore";
import { authState } from "../../lib/client/stores/authStore";
import { tabsState } from "../../lib/client/stores/tabStore";

// --- Mocks ---
const { mockNavigate, mockReplicacheClient } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockReplicacheClient: {
    mutate: {
      createNote: vi.fn(),
    },
  },
}));

vi.mock("../../lib/client/router", () => ({
  navigate: mockNavigate,
}));

vi.mock("../../lib/client/runtime", () => ({
  runClientUnscoped: () => Promise.resolve(),
}));

vi.mock("../../lib/client/replicache", async () => {
  const { Context } = await import("effect");
  class ReplicacheService extends Context.Tag("ReplicacheService")<
    ReplicacheService,
    { client: any }
  >() {}
  
  return { 
    ReplicacheService: {
        ...ReplicacheService,
        pipe: () => ({ client: mockReplicacheClient }), 
        [Symbol.iterator]: function* () { yield { client: mockReplicacheClient }; }
    } 
  };
});

describe("Sidebar Component", () => {
  if (!customElements.get("side-bar")) {
    customElements.define("side-bar", Sidebar);
  }

  // Polyfill dialog methods for JSDOM
  beforeAll(() => {
    if (typeof window.HTMLDialogElement === 'undefined') {
        window.HTMLDialogElement = class {} as any;
    }
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    noteListState.value = [];
    sidebarState.value = true;
    tabsState.value = []; 
    // ✅ FIX: Add context properties to mock authState
    authState.value = { 
        status: "authenticated", 
        user: { id: "u1" } as any,
        currentTenant: { id: "t1", name: "Test Tenant", subdomain: "test" },
        currentRole: "OWNER"
    };
  });

  it("renders a list of notes from the store", async () => {
    noteListState.value = [
      { id: "n1", title: "Note A", updated_at: new Date() } as any,
      { id: "n2", title: "Note B", updated_at: new Date() } as any,
    ];

    const sidebar = new Sidebar();
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;

    const links = sidebar.querySelectorAll("a");
    expect(links.length).toBe(2);
    expect(links[0]!.textContent?.trim()).toContain("Note A");
    expect(links[1]!.textContent?.trim()).toContain("Note B");

    document.body.removeChild(sidebar);
  });

  it("navigates when a note is clicked", async () => {
    noteListState.value = [{ id: "n1", title: "Note A" } as any];

    const sidebar = new Sidebar();
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;

    const link = sidebar.querySelector("a");
    link!.click();

    expect(mockNavigate).toHaveBeenCalledWith("/notes/n1");
    document.body.removeChild(sidebar);
  });

  it("shows an indicator for notes that are open in tabs", async () => {
    // Note n1 is in tabs, n2 is not
    noteListState.value = [
      { id: "n1", title: "Open Note" } as any,
      { id: "n2", title: "Closed Note" } as any
    ];
    tabsState.value = [{ id: "n1", title: "Open Note" }];

    const sidebar = new Sidebar();
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;

    const links = sidebar.querySelectorAll("a");
    const link1 = links[0];
    const link2 = links[1];

    // Check for the indicator span (title="Open in tabs")
    const indicator1 = link1?.querySelector('[title="Open in tabs"]');
    const indicator2 = link2?.querySelector('[title="Open in tabs"]');

    expect(indicator1).not.toBeNull(); // Should exist
    expect(indicator2).toBeNull();     // Should NOT exist

    document.body.removeChild(sidebar);
  });
});
