// FILE: src/lib/client/controllers/table-controller.test.ts
import { describe, it, expect, vi } from "vitest";
import { TableController } from "./table-controller";
import { signal } from "@preact/signals-core";

// Mock Host
const mockHost = {
  addController: vi.fn(),
  requestUpdate: vi.fn(),
  updateComplete: Promise.resolve(true),
} as any;

interface TestItem {
  id: number;
  name: string;
  role: string;
}

const data: TestItem[] = [
  { id: 1, name: "Alice", role: "Admin" },
  { id: 2, name: "Bob", role: "User" },
  { id: 3, name: "Charlie", role: "User" },
  { id: 4, name: "David", role: "Manager" },
  { id: 5, name: "Eve", role: "Guest" },
];

describe("TableController Logic", () => {
  it("initializes correctly", () => {
    const source = signal(data);
    const ctrl = new TableController<TestItem>(mockHost, { source, initialPageSize: 2 });
    
    expect(ctrl.totalItems.value).toBe(5);
    expect(ctrl.totalPages.value).toBe(3); // 5 items / 2 per page = 3 pages
    expect(ctrl.viewRows.value).toHaveLength(2); // First page
  });

  it("filters data (Search)", () => {
    const source = signal(data);
    const ctrl = new TableController<TestItem>(mockHost, { source, searchableFields: ["name"] });

    // 'a' matches Alice, Charlie, David
    ctrl.setSearch("a");
    
    expect(ctrl.totalItems.value).toBe(3);
    const names = ctrl.viewRows.value.map(x => x.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Charlie");
    expect(names).toContain("David");
    expect(names).not.toContain("Bob");
  });

  it("sorts data (ASC/DESC)", () => {
    const source = signal(data);
    const ctrl = new TableController<TestItem>(mockHost, { source });

    // Sort by Name Descending
    ctrl.handleSort("name"); // asc
    ctrl.handleSort("name"); // desc

    const rows = ctrl.viewRows.value;
    expect(rows[0]?.name).toBe("Eve"); // E first in desc
    expect(rows[4]?.name).toBe("Alice"); // A last in desc
  });

  it("paginates data", () => {
    const source = signal(data);
    const ctrl = new TableController<TestItem>(mockHost, { source, initialPageSize: 2 });

    // Page 1: Alice, Bob
    expect(ctrl.viewRows.value[0]?.name).toBe("Alice");
    expect(ctrl.viewRows.value[1]?.name).toBe("Bob");

    ctrl.setPage(2);
    // Page 2: Charlie, David
    expect(ctrl.viewRows.value[0]?.name).toBe("Charlie");
    expect(ctrl.viewRows.value[1]?.name).toBe("David");

    ctrl.setPage(3);
    // Page 3: Eve
    expect(ctrl.viewRows.value[0]?.name).toBe("Eve");
    expect(ctrl.viewRows.value).toHaveLength(1);
  });

  it("resets page when search changes", () => {
    const source = signal(data);
    const ctrl = new TableController<TestItem>(mockHost, { source, initialPageSize: 1 });

    ctrl.setPage(3);
    expect(ctrl.pagination.value.page).toBe(3);

    ctrl.setSearch("Bob");
    expect(ctrl.pagination.value.page).toBe(1);
    expect(ctrl.viewRows.value[0]?.name).toBe("Bob");
  });
});
