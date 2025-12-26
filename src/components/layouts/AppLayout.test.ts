// FILE: src/components/layouts/AppLayout.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppLayout } from "./AppLayout";

// --- Mock Child Components to avoid noise ---
customElements.define("side-bar-mock", class extends HTMLElement {});
customElements.define("tab-bar-mock", class extends HTMLElement {});
customElements.define("language-switcher-mock", class extends HTMLElement {});
customElements.define("mobile-sidebar-backdrop-mock", class extends HTMLElement {});

// --- Mock Dependencies ---
vi.mock("./Sidebar", () => ({ Sidebar: class {} }));
vi.mock("./TabBar", () => ({ TabBar: class {} }));
vi.mock("../features/language-switcher", () => ({}));
vi.mock("../ui/mobile-sidebar-backdrop", () => ({}));

if (!customElements.get("app-layout")) {
  customElements.define("app-layout", AppLayout);
}

describe("AppLayout", () => {
  let element: AppLayout;

  beforeEach(() => {
    element = new AppLayout();
    document.body.appendChild(element);
  });

  afterEach(() => {
    document.body.removeChild(element);
  });

  it("renders side-bar only when authenticated", async () => {
    // Unauthenticated
    // ✅ FIX: Add context properties to match AuthModel
    element.auth = { 
        status: "unauthenticated", 
        user: null, 
        currentTenant: null, 
        currentRole: null 
    };
    await element.updateComplete;
    expect(element.querySelector("side-bar")).toBeNull();

    // Authenticated
    // ✅ FIX: Add context properties to match AuthModel
    element.auth = { 
        status: "authenticated", 
        user: { id: "u1" } as any,
        currentTenant: { id: "t1", name: "Test Tenant", subdomain: "test" },
        currentRole: "OWNER"
    };
    await element.updateComplete;
    expect(element.querySelector("side-bar")).not.toBeNull();
  });

  it("renders tab-bar ONLY when authenticated AND path starts with /notes/", async () => {
    // ✅ FIX: Add context properties to match AuthModel
    element.auth = { 
        status: "authenticated", 
        user: { id: "u1" } as any,
        currentTenant: { id: "t1", name: "Test Tenant", subdomain: "test" },
        currentRole: "OWNER"
    };
    
    // Case 1: Dashboard (/)
    element.currentPath = "/";
    await element.updateComplete;
    expect(element.querySelector("tab-bar")).toBeNull();

    // Case 2: Profile (/profile)
    element.currentPath = "/profile";
    await element.updateComplete;
    expect(element.querySelector("tab-bar")).toBeNull();

    // Case 3: Note (/notes/123)
    element.currentPath = "/notes/123";
    await element.updateComplete;
    expect(element.querySelector("tab-bar")).not.toBeNull();
  });

  it("does not render tab-bar when unauthenticated even if path is /notes/", async () => {
    // This case theoretically happens if redirect hasn't hit yet or public note
    // ✅ FIX: Add context properties to match AuthModel
    element.auth = { 
        status: "unauthenticated", 
        user: null,
        currentTenant: null,
        currentRole: null
    };
    element.currentPath = "/notes/public";
    await element.updateComplete;
    
    expect(element.querySelector("tab-bar")).toBeNull();
  });
});
