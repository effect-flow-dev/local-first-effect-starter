// FILE: src/components/ui/sync-status.wtr.test.ts
import { html, fixture, expect, elementUpdated } from "@open-wc/testing";
import { SyncStatus } from "./sync-status";
import {
  syncStatusState,
  pendingMutationCountState,
  lastErrorState,
  isOnlineState,
} from "../../lib/client/stores/syncStore";

// Register if needed
if (!customElements.get("sync-status")) {
  customElements.define("sync-status", SyncStatus);
}

describe("UI: <sync-status>", () => {
  beforeEach(() => {
    // Reset signals to default before each test
    syncStatusState.value = "synced";
    pendingMutationCountState.value = 0;
    lastErrorState.value = null;
    isOnlineState.value = true;
  });

  it("renders 'Saved' (green) when synced and online", async () => {
    const el = await fixture<SyncStatus>(html`<sync-status></sync-status>`);

    // The component renders into Light DOM (createRenderRoot returns this)
    const badge = el.querySelector("div");
    
    expect(badge).to.exist;
    expect(badge?.textContent).to.include("Saved");
    
    // Check classes for Green styling
    expect(badge?.classList.contains("bg-green-50")).to.be.true;
    expect(badge?.classList.contains("text-green-700")).to.be.true;
  });

  it("renders 'Syncing...' (amber) when status is syncing", async () => {
    const el = await fixture<SyncStatus>(html`<sync-status></sync-status>`);

    // Trigger state change
    syncStatusState.value = "syncing";
    await elementUpdated(el);

    const badge = el.querySelector("div");
    expect(badge?.textContent).to.include("Syncing...");
    
    // Check classes for Amber styling
    expect(badge?.classList.contains("bg-amber-50")).to.be.true;
    expect(badge?.classList.contains("text-amber-700")).to.be.true;
  });

  it("renders 'Saving (N)...' when pending count > 0", async () => {
    const el = await fixture<SyncStatus>(html`<sync-status></sync-status>`);

    // Trigger pending count
    pendingMutationCountState.value = 5;
    await elementUpdated(el);

    const badge = el.querySelector("div");
    expect(badge?.textContent).to.include("Saving (5)...");
    
    // Still Amber
    expect(badge?.classList.contains("bg-amber-50")).to.be.true;
  });

  it("renders 'Sync Error' (red) when status is error", async () => {
    const el = await fixture<SyncStatus>(html`<sync-status></sync-status>`);

    syncStatusState.value = "error";
    lastErrorState.value = "Auth Token Expired";
    await elementUpdated(el);

    const badge = el.querySelector("div");
    expect(badge?.textContent).to.include("Sync Error");
    
    // Check classes for Red styling
    expect(badge?.classList.contains("bg-red-50")).to.be.true;
    expect(badge?.classList.contains("text-red-700")).to.be.true;
    
    // Check tooltip
    expect(badge?.getAttribute("title")).to.equal("Auth Token Expired");
  });

  it("renders 'Offline' (gray) when isOnline is false, overriding error state", async () => {
    const el = await fixture<SyncStatus>(html`<sync-status></sync-status>`);

    // Simulate Offline AND Error
    isOnlineState.value = false;
    syncStatusState.value = "error"; 
    await elementUpdated(el);

    const badge = el.querySelector("div");
    expect(badge?.textContent).to.include("Offline");
    
    // Check classes for Zinc/Gray styling
    expect(badge?.classList.contains("bg-zinc-100")).to.be.true;
    expect(badge?.classList.contains("text-zinc-500")).to.be.true;
  });

  it("shows pending count next to 'Offline' if mutations exist", async () => {
    const el = await fixture<SyncStatus>(html`<sync-status></sync-status>`);

    isOnlineState.value = false;
    pendingMutationCountState.value = 3;
    await elementUpdated(el);

    const badge = el.querySelector("div");
    // Should show "Offline (3)"
    expect(badge?.textContent).to.include("Offline");
    expect(badge?.textContent).to.include("(3)");
  });
});
