// FILE: src/components/ui/mobile-sidebar-backdrop.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MobileSidebarBackdrop } from "./mobile-sidebar-backdrop";
import { sidebarState } from "../../lib/client/stores/sidebarStore";

// Mock the store module to spy on closeSidebar
const { mockCloseSidebar, mockEffect } = vi.hoisted(() => ({
  mockCloseSidebar: vi.fn(),
  mockEffect: vi.fn((fn) => { fn(); return () => {}; }),
}));

vi.mock("../../lib/client/stores/sidebarStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/client/stores/sidebarStore")>();
  return {
    ...actual,
    closeSidebar: mockCloseSidebar,
  };
});

vi.mock("@preact/signals-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@preact/signals-core")>();
  return {
    ...actual,
    effect: mockEffect,
  };
});

if (!customElements.get("mobile-sidebar-backdrop")) {
  customElements.define("mobile-sidebar-backdrop", MobileSidebarBackdrop);
}

describe("MobileSidebarBackdrop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarState.value = false;
  });

  it("renders with 'open' class when sidebarState is true", async () => {
    sidebarState.value = true;
    const el = new MobileSidebarBackdrop();
    document.body.appendChild(el);
    await el.updateComplete;

    // createRenderRoot returns this (Light DOM) or shadowRoot based on implementation.
    // The component uses Shadow DOM (default Lit behavior).
    const backdrop = el.shadowRoot!.querySelector(".backdrop");
    
    expect(backdrop).toBeTruthy();
    expect(backdrop?.classList.contains("open")).toBe(true);
    
    document.body.removeChild(el);
  });

  it("renders without 'open' class when sidebarState is false", async () => {
    sidebarState.value = false;
    const el = new MobileSidebarBackdrop();
    document.body.appendChild(el);
    await el.updateComplete;

    const backdrop = el.shadowRoot!.querySelector(".backdrop");
    expect(backdrop?.classList.contains("open")).toBe(false);
    
    document.body.removeChild(el);
  });

  it("calls closeSidebar when clicked", async () => {
    sidebarState.value = true;
    const el = new MobileSidebarBackdrop();
    document.body.appendChild(el);
    await el.updateComplete;

    const backdrop = el.shadowRoot!.querySelector(".backdrop") as HTMLElement;
    backdrop.click();

    expect(mockCloseSidebar).toHaveBeenCalled();
    
    document.body.removeChild(el);
  });
});
