import { type ReactiveController, type ReactiveControllerHost } from "lit";
import { signal, computed, effect, type ReadonlySignal, type Signal } from "@preact/signals-core";

export type SortDirection = "asc" | "desc";

export interface SortState<T> {
  field: keyof T | null;
  direction: SortDirection;
}

export interface PaginationState {
  page: number;
  pageSize: number;
}

export interface TableControllerOptions<T> {
  /**
   * The source of truth for the data. Can be a Signal or a getter function.
   */
  source: Signal<T[]> | (() => T[]);
  
  /**
   * Fields to include in the fuzzy search.
   * If omitted, performs a naive JSON stringify search (slower).
   */
  searchableFields?: (keyof T)[];

  /**
   * Initial page size. Defaults to 10.
   */
  initialPageSize?: number;
}

/**
 * Pure helper functions for table logic (Separated for easier unit testing if needed independently)
 */
const Logic = {
  filter: <T>(data: T[], query: string, fields?: (keyof T)[]): T[] => {
    if (!query.trim()) return data;
    const lowerQuery = query.toLowerCase();

    return data.filter((item) => {
      // Strategy 1: Specific fields
      if (fields) {
        return fields.some((key) => {
          const val = item[key];
          return String(val).toLowerCase().includes(lowerQuery);
        });
      }
      // Strategy 2: Naive object scan
      return Object.values(item as Record<string, unknown>).some((val) =>
        String(val).toLowerCase().includes(lowerQuery)
      );
    });
  },

  sort: <T>(data: T[], sort: SortState<T>): T[] => {
    if (!sort.field) return data;
    
    // Create a shallow copy to avoid mutating the original array
    const sorted = [...data].sort((a, b) => {
      const aVal = a[sort.field!];
      const bVal = b[sort.field!];

      if (aVal === bVal) return 0;
      
      // Handle nulls/undefined safely
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (aVal < bVal) return sort.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  },

  paginate: <T>(data: T[], page: number, pageSize: number): T[] => {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return data.slice(start, end);
  }
};

export class TableController<T> implements ReactiveController {
  // --- Inputs ---
  public searchQuery: Signal<string>;
  public sortState: Signal<SortState<T>>;
  public pagination: Signal<PaginationState>;
  
  // --- Internals ---
  private host: ReactiveControllerHost;
  private sourceSignal: Signal<T[]> | (() => T[]);
  private dispose?: () => void;

  // --- Computed Outputs ---
  public totalItems: ReadonlySignal<number>;
  public totalPages: ReadonlySignal<number>;
  public viewRows: ReadonlySignal<T[]>;

  constructor(host: ReactiveControllerHost, options: TableControllerOptions<T>) {
    this.host = host;
    this.sourceSignal = options.source;
    host.addController(this);

    // 1. Initialize State Signals
    this.searchQuery = signal("");
    this.sortState = signal<SortState<T>>({ field: null, direction: "asc" });
    this.pagination = signal<PaginationState>({ 
      page: 1, 
      pageSize: options.initialPageSize || 10 
    });

    // 2. Normalize Source
    // If a function is passed, we wrap it in a computed to make it a signal
    const rawData = typeof options.source === 'function' 
        ? computed(options.source) 
        : options.source;

    // 3. Build the Pipeline (Computed Signals)
    
    // A: Filtered Data (Source + Search)
    const filteredData = computed(() => {
        return Logic.filter(rawData.value, this.searchQuery.value, options.searchableFields);
    });

    // B: Sorted Data (Filtered + Sort)
    const sortedData = computed(() => {
        return Logic.sort(filteredData.value, this.sortState.value);
    });

    // C: View Data (Sorted + Pagination)
    this.viewRows = computed(() => {
        const { page, pageSize } = this.pagination.value;
        return Logic.paginate(sortedData.value, page, pageSize);
    });

    // D: Metadata
    this.totalItems = computed(() => filteredData.value.length);
    this.totalPages = computed(() => Math.ceil(this.totalItems.value / this.pagination.value.pageSize));
  }

  hostConnected() {
    // Subscribe to the final output. Any change in the pipeline triggers a host update.
    this.dispose = effect(() => {
      // Access the value to subscribe
      void this.viewRows.value;
      void this.totalItems.value;
      void this.pagination.value;
      
      this.host.requestUpdate();
    });
  }

  hostDisconnected() {
    this.dispose?.();
  }

  // --- Public API ---

  setSearch(term: string) {
    this.searchQuery.value = term;
    // Reset to page 1 on new search
    this.setPage(1);
  }

  handleSort(field: keyof T) {
    const current = this.sortState.peek();
    
    if (current.field === field) {
        // Toggle direction: asc -> desc -> null (reset)
        if (current.direction === "asc") {
            this.sortState.value = { field, direction: "desc" };
        } else {
            this.sortState.value = { field: null, direction: "asc" };
        }
    } else {
        // New field, default to asc
        this.sortState.value = { field, direction: "asc" };
    }
  }

  setPage(page: number) {
    const max = this.totalPages.peek();
    const safePage = Math.max(1, Math.min(page, max || 1)); // Handle 0 items case
    
    // Only update if changed to avoid loops
    if (this.pagination.peek().page !== safePage) {
        this.pagination.value = { 
            ...this.pagination.peek(), 
            page: safePage 
        };
    }
  }

  setPageSize(size: number) {
    this.pagination.value = { page: 1, pageSize: size };
  }
}
