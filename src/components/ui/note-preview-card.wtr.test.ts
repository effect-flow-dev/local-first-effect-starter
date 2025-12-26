// FILE: src/components/ui/note-preview-card.wtr.test.ts
import { html, fixture, expect } from "@open-wc/testing";
import { NotePreviewCard } from "./note-preview-card";

if (!customElements.get("note-preview-card")) {
  customElements.define("note-preview-card", NotePreviewCard);
}

describe("UI: <note-preview-card>", () => {
  it("renders loading state correctly", async () => {
    const el = await fixture<NotePreviewCard>(html`
      <note-preview-card .title=${"Loading..."} ?isLoading=${true}></note-preview-card>
    `);

    const loadingDiv = el.shadowRoot?.querySelector(".loading");
    expect(loadingDiv).to.exist;
    expect(loadingDiv?.textContent).to.equal("Loading preview...");
  });

  it("renders content when loaded", async () => {
    const el = await fixture<NotePreviewCard>(html`
      <note-preview-card 
        .title=${"My Note"} 
        .snippet=${"This is a preview."}
        .x=${100}
        .y=${100}
      ></note-preview-card>
    `);

    const title = el.shadowRoot?.querySelector(".title");
    const snippet = el.shadowRoot?.querySelector(".snippet");

    expect(title?.textContent).to.equal("My Note");
    expect(snippet?.textContent).to.equal("This is a preview.");
    
    // Verify positioning style
    const card = el.shadowRoot?.querySelector(".card") as HTMLElement;
    expect(card.style.left).to.equal("100px");
    // Top includes the +20 offset
    expect(card.style.top).to.equal("120px");
  });
});
