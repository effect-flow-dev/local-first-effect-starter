// FILE: src/components/blocks/meter-input.wtr.test.ts
import { html, fixture, expect, oneEvent } from "@open-wc/testing";
import { MeterInput } from "./meter-input";

if (!customElements.get("meter-input")) {
  customElements.define("meter-input", MeterInput);
}

describe("Block: MeterInput", () => {
  it("renders label and initial value", async () => {
    const el = await fixture<MeterInput>(html`
      <meter-input label="Pressure" .value=${50} unit="PSI"></meter-input>
    `);

    expect(el.querySelector("label")?.textContent).to.equal("Pressure");
    const input = el.querySelector("input");
    expect(input?.value).to.equal("50");
  });

  it("shows error when value exceeds max", async () => {
    const el = await fixture<MeterInput>(html`
      <meter-input .value=${150} .max=${100}></meter-input>
    `);
    
    // We expect validation to run on initial render/update
    await el.updateComplete;
    
    const errorMsg = el.querySelector(".text-red-600");
    expect(errorMsg).to.exist;
    expect(errorMsg?.textContent).to.include("Exceeds Maximum");
  });

  it("dispatches increment-block event on stepper click", async () => {
    const el = await fixture<MeterInput>(html`
      <meter-input .blockId=${"m1"} .value=${10}></meter-input>
    `);

    const plusBtn = el.querySelector('button[aria-label="Increase"]') as HTMLElement;
    
    // Click triggers immediate dispatch
    setTimeout(() => plusBtn.click());

    const ev = await oneEvent(el, "increment-block");
    expect(ev.detail.key).to.equal("value");
    expect(ev.detail.delta).to.equal(1);
  });

  it("dispatches increment-block (atomic delta) on text input", async () => {
    const el = await fixture<MeterInput>(html`
      <meter-input .blockId=${"m1"} .value=${10}></meter-input>
    `);

    const input = el.querySelector("input") as HTMLInputElement;
    input.value = "15";
    input.dispatchEvent(new Event("input"));

    // Wait for debounce (500ms) + small buffer
    const ev = await oneEvent(el, "increment-block");
    
    expect(ev.detail.key).to.equal("value");
    // Initial 10 -> Input 15 = Delta 5
    expect(ev.detail.delta).to.equal(5);
  });
});
