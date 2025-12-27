// FILE: src/components/blocks/map-block.wtr.test.ts
import { html, fixture, expect, elementUpdated } from "@open-wc/testing";
import { MapBlock } from "./map-block";

// Ensure component is registered
if (!customElements.get("map-block")) {
  customElements.define("map-block", MapBlock);
}

describe("Block: <map-block>", () => {
  it("renders the container structure", async () => {
    const el = await fixture<MapBlock>(html`
      <map-block 
        .blockId=${"test-map-1"} 
        .latitude=${51.5} 
        .longitude=${-0.09} 
        .zoom=${13}
      ></map-block>
    `);

    // Wait for Leaflet to initialize (if it runs)
    await elementUpdated(el);

    const container = el.querySelector(".map-container");
    expect(container).to.exist;
    
    // Check if Leaflet added its classes (Leaflet modifies the DOM immediately on init)
    // If this fails in headless environments without full canvas support, we might need to mock L.map,
    // but typically WTR + Playwright runner handles this fine.
    expect(container?.classList.contains("leaflet-container")).to.be.true;
  });

  it("displays coordinates in the footer", async () => {
    const lat = 40.7128;
    const lon = -74.0060;
    
    const el = await fixture<MapBlock>(html`
      <map-block 
        .latitude=${lat} 
        .longitude=${lon}
      ></map-block>
    `);

    const footer = el.querySelector(".bg-white"); // The footer div
    expect(footer).to.exist;
    expect(footer?.textContent).to.include(lat.toFixed(4));
    expect(footer?.textContent).to.include(lon.toFixed(4));
  });
});
