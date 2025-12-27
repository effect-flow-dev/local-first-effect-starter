// FILE: src/components/ui/presence-indicator.wtr.test.ts
import { html, fixture, expect } from "@open-wc/testing";
import { PresenceIndicator } from "./presence-indicator";
import { presenceState } from "../../lib/client/stores/presenceStore";
import { authState } from "../../lib/client/stores/authStore";

// Register if needed
if (!customElements.get("presence-indicator")) {
  customElements.define("presence-indicator", PresenceIndicator);
}

describe("UI: <presence-indicator>", () => {
  const BLOCK_ID = "test-block";
  const SELF_ID = "me";
  
  beforeEach(() => {
    // Reset stores
    authState.value = { 
        status: "authenticated", 
        user: { id: SELF_ID } as any,
        currentTenant: null,
        currentRole: null
    };
    presenceState.value = {};
  });

  it("renders nothing when no users are present", async () => {
    const el = await fixture<PresenceIndicator>(html`
      <presence-indicator .blockId=${BLOCK_ID}></presence-indicator>
    `);
    
    expect(el.shadowRoot?.children.length).to.equal(0);
  });

  it("renders remote users but excludes self", async () => {
    presenceState.value = {
        [BLOCK_ID]: [
            { userId: "other-1", color: "#FF0000", lastActive: Date.now() },
            { userId: SELF_ID, color: "#00FF00", lastActive: Date.now() }
        ]
    };

    const el = await fixture<PresenceIndicator>(html`
      <presence-indicator .blockId=${BLOCK_ID}></presence-indicator>
    `);

    const avatars = el.shadowRoot?.querySelectorAll(".avatar");
    expect(avatars?.length).to.equal(1);
    
    // Should show the other user
    const avatar = avatars![0] as HTMLElement;
    expect(avatar.title).to.include("other-1");
    // Should have correct color
    expect(avatar.style.backgroundColor).to.equal("rgb(255, 0, 0)"); // CSS standardizes hex to rgb
  });

  it("shows overflow indicator when more than 3 remote users are present", async () => {
    presenceState.value = {
        [BLOCK_ID]: [
            { userId: "u1", color: "#111", lastActive: Date.now() },
            { userId: "u2", color: "#222", lastActive: Date.now() },
            { userId: "u3", color: "#333", lastActive: Date.now() },
            { userId: "u4", color: "#444", lastActive: Date.now() },
            { userId: "u5", color: "#555", lastActive: Date.now() },
        ]
    };

    const el = await fixture<PresenceIndicator>(html`
      <presence-indicator .blockId=${BLOCK_ID}></presence-indicator>
    `);

    const avatars = el.shadowRoot?.querySelectorAll(".avatar");
    // Should render 3 avatars + 1 overflow = 4 elements
    expect(avatars?.length).to.equal(4);

    const lastElement = avatars![3] as HTMLElement;
    expect(lastElement.textContent?.trim()).to.equal("+2");
  });
});
