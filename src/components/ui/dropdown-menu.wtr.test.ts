// FILE: ./src/components/ui/dropdown-menu.wtr.test.ts
import { html, fixture, expect } from "@open-wc/testing";
import { DropdownMenu } from "./dropdown-menu";

// Register the component if not already registered
if (!customElements.get("dropdown-menu")) {
  customElements.define("dropdown-menu", DropdownMenu);
}

describe("Component: <dropdown-menu> (Shadow DOM & Slots)", () => {
  let el: DropdownMenu;

  beforeEach(async () => {
    // Fixture setup: Use light DOM content for the slots
    el = await fixture<DropdownMenu>(html`
      <dropdown-menu>
        <button slot="trigger">Open</button>
        <div slot="content" id="dropdown-item">Menu Item</div>
      </dropdown-menu>
    `);
  });

  it("renders trigger and content wrappers in Shadow DOM", () => {
    const shadowRoot = el.shadowRoot;
    expect(shadowRoot).to.exist;

    const triggerWrapper = shadowRoot?.getElementById("trigger-wrapper");
    const contentWrapper = shadowRoot?.getElementById("content-wrapper");

    expect(triggerWrapper).to.exist;
    expect(contentWrapper).to.exist;

    // Check if slot content is correctly distributed to the light DOM
    expect(triggerWrapper?.querySelector('slot[name="trigger"]')).to.exist;
    expect(contentWrapper?.querySelector('slot[name="content"]')).to.exist;

    // Check initial state: content should be hidden
    expect(contentWrapper?.classList.contains("open")).to.be.false;
  });

  it("toggles open/closed state when trigger is clicked", async () => {
    const triggerWrapper = el.shadowRoot?.getElementById(
      "trigger-wrapper",
    ) as HTMLElement;
    const contentWrapper = el.shadowRoot?.getElementById(
      "content-wrapper",
    ) as HTMLElement;

    // 1. Open
    triggerWrapper.click();
    await el.updateComplete;
    expect(el["isOpen"]).to.be.true;
    expect(contentWrapper.classList.contains("open")).to.be.true;

    // 2. Close
    triggerWrapper.click();
    await el.updateComplete;
    expect(el["isOpen"]).to.be.false;
    expect(contentWrapper.classList.contains("open")).to.be.false;
  });

  it("closes when an outside click occurs", async () => {
    // 1. Open the dropdown
    // Access private method using bracket notation for tests
    (el as any)["open"]();
    await el.updateComplete;
    expect(el["isOpen"]).to.be.true;

    // 2. Simulate a click outside the component
    document.body.click();

    // Check that the state updated
    await el.updateComplete;
    
    expect(el["isOpen"]).to.be.false;
  });

  it("remains open when a click occurs inside the dropdown element itself", async () => {
    // 1. Open the dropdown
    (el as any)["open"]();
    await el.updateComplete;

    // 2. Click a light DOM element inside the content slot
    const menuItem = el.querySelector('#dropdown-item') as HTMLElement;
    menuItem.click();

    // The internal check should prevent 'close()' from being called.
    await el.updateComplete;
    
    expect(el["isOpen"]).to.be.true;
  });
});
