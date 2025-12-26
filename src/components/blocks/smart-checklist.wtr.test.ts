// FILE: src/components/blocks/smart-checklist.wtr.test.ts
import { html, fixture, expect, oneEvent } from "@open-wc/testing";
import { SmartChecklist } from "./smart-checklist";

if (!customElements.get("smart-checklist")) {
  customElements.define("smart-checklist", SmartChecklist);
}

describe("Block: SmartChecklist", () => {
  it("renders provided items correctly", async () => {
    const items = [
      { id: "1", label: "Check Tires", checked: false },
      { id: "2", label: "Check Oil", checked: true },
    ];
    
    const el = await fixture<SmartChecklist>(html`
      <smart-checklist .items=${items}></smart-checklist>
    `);

    const rows = el.querySelectorAll("div.flex.items-center.justify-between");
    expect(rows.length).to.equal(2);
    
    // Use '!' because we verified length is 2
    expect(rows[0]!.textContent).to.include("Check Tires");
    expect(rows[0]!.classList.contains("bg-white")).to.be.true;
    
    expect(rows[1]!.textContent).to.include("Check Oil");
    expect(rows[1]!.classList.contains("bg-green-50")).to.be.true;
  });

  it("dispatches update-block event when item is toggled", async () => {
    const items = [{ id: "1", label: "Toggle Me", checked: false }];
    const el = await fixture<SmartChecklist>(html`
      <smart-checklist .blockId=${"block-1"} .items=${items}></smart-checklist>
    `);

    const row = el.querySelector("div.cursor-pointer") as HTMLElement;
    
    // Trigger click
    setTimeout(() => row.click());
    
    const ev = await oneEvent(el, "update-block");
    
    expect(ev.detail.blockId).to.equal("block-1");
    expect(ev.detail.fields.items[0].checked).to.be.true;
  });
});
