// FILE: src/components/layouts/Sidebar.wtr.test.ts
import { html, fixture, expect } from "@open-wc/testing";
import { Sidebar } from "./Sidebar";
import { noteListState } from "../../lib/client/stores/noteListStore";
import { sidebarState } from "../../lib/client/stores/sidebarStore";
import { authState } from "../../lib/client/stores/authStore";
import type { AppNoteMetadata } from "../../lib/shared/schemas";

// Register the component if not already registered
if (!customElements.get("side-bar")) {
  customElements.define("side-bar", Sidebar);
}

describe("Layout: Sidebar", () => {
  beforeEach(() => {
    // Reset global state before each test
    noteListState.value = [];
    sidebarState.value = true;
    
    // ✅ FIX: Add context properties to mock authState
    authState.value = { 
        status: "authenticated", 
        user: { id: "test-user" } as any,
        currentTenant: { id: "t1", name: "Test Tenant", subdomain: "test" },
        currentRole: "OWNER"
    };
  });

  it("renders empty state when no notes exist", async () => {
    const el = await fixture<Sidebar>(html`<side-bar></side-bar>`);
    
    expect(el.textContent).to.include("No notes yet");
  });

  it("renders a list of notes when store updates", async () => {
    const el = await fixture<Sidebar>(html`<side-bar></side-bar>`);

    // Update the signal with Metadata objects
    noteListState.value = [
      { id: "1", title: "First Note" } as AppNoteMetadata,
      { id: "2", title: "Second Note" } as AppNoteMetadata,
    ];

    // Wait for Lit to react to the signal
    await el.updateComplete;

    const links = el.querySelectorAll("a");
    expect(links.length).to.equal(2);
    expect(links[0]?.textContent?.trim()).to.equal("First Note");
    expect(links[1]?.textContent?.trim()).to.equal("Second Note");
  });

  it("toggles visibility classes based on sidebarState", async () => {
    const el = await fixture<Sidebar>(html`<side-bar></side-bar>`);
    
    // Initial state: open (set in beforeEach)
    const container = el.querySelector(".sidebar")!;
    expect(container.classList.contains("open")).to.be.true;
    expect(container.classList.contains("closed")).to.be.false;

    // Toggle state
    sidebarState.value = false;
    await el.updateComplete;

    expect(container.classList.contains("open")).to.be.false;
    expect(container.classList.contains("closed")).to.be.true;
  });
});
