// FILE: src/components/pages/notes-table-page.wtr.test.ts
import { html, fixture, expect, elementUpdated } from "@open-wc/testing";
import { NotesTablePage } from "./notes-table-page";
import { noteListState } from "../../lib/client/stores/noteListStore";
import type { AppNoteMetadata } from "../../lib/shared/schemas";

// Register component
if (!customElements.get("notes-table-page")) {
  customElements.define("notes-table-page", NotesTablePage);
}

describe("Page: Notes Table", () => {
  const mockNotes: AppNoteMetadata[] = [
    { id: "1", title: "Alpha Note", updated_at: new Date("2023-01-01") } as any,
    { id: "2", title: "Beta Note", updated_at: new Date("2023-01-02") } as any,
    { id: "3", title: "Charlie Note", updated_at: new Date("2023-01-03") } as any,
  ];

  beforeEach(() => {
    noteListState.value = [];
  });

  it("renders empty state", async () => {
    const el = await fixture<NotesTablePage>(html`<notes-table-page></notes-table-page>`);
    const rows = el.querySelectorAll("tbody tr");
    // Should have 1 row for "No notes found"
    expect(rows.length).to.equal(1);
    expect(el.textContent).to.include("No notes found");
  });

  it("renders rows from store", async () => {
    noteListState.value = mockNotes;
    const el = await fixture<NotesTablePage>(html`<notes-table-page></notes-table-page>`);
    
    // Wait for Lit update cycle
    await elementUpdated(el);

    const rows = el.querySelectorAll("tbody tr");
    expect(rows.length).to.equal(3);
    
    // Check content of first row
    const firstRowTitle = rows[0]?.querySelector("a")?.textContent?.trim();
    expect(firstRowTitle).to.equal("Alpha Note");
  });

  it("filters rows when search input changes", async () => {
    noteListState.value = mockNotes;
    const el = await fixture<NotesTablePage>(html`<notes-table-page></notes-table-page>`);
    
    const searchEl = el.querySelector("table-search");
    // Simulate search event dispatch
    searchEl?.dispatchEvent(new CustomEvent("search", { detail: "Beta" }));
    
    await elementUpdated(el);
    
    const rows = el.querySelectorAll("tbody tr");
    expect(rows.length).to.equal(1);
    expect(rows[0]?.textContent).to.include("Beta Note");
  });

  it("sorts rows when header clicked", async () => {
    noteListState.value = mockNotes;
    const el = await fixture<NotesTablePage>(html`<notes-table-page></notes-table-page>`);
    
    // Find the Title header
    const titleHeader = el.querySelector("table-header[sortKey='title']");
    
    // 1. Click -> ASC (Default is usually ASC, but let's check)
    // Controller logic: default null -> click -> ASC
    // List is already Alpha, Beta, Charlie. 
    // Let's click TWICE to get DESC (Charlie, Beta, Alpha)
    
    titleHeader?.dispatchEvent(new CustomEvent("sort", { detail: "title" })); // ASC
    await elementUpdated(el);
    
    titleHeader?.dispatchEvent(new CustomEvent("sort", { detail: "title" })); // DESC
    await elementUpdated(el);

    const rows = el.querySelectorAll("tbody tr");
    const firstRowTitle = rows[0]?.querySelector("a")?.textContent?.trim();
    
    expect(firstRowTitle).to.equal("Charlie Note");
  });
});
