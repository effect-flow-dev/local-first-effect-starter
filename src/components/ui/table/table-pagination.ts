import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("table-pagination")
export class TablePagination extends LitElement {
  @property({ type: Number }) page = 1;
  @property({ type: Number }) pageSize = 10;
  @property({ type: Number }) totalItems = 0;

  protected override createRenderRoot() {
    return this;
  }

  private _handlePage(newPage: number) {
    this.dispatchEvent(
      new CustomEvent("page-change", {
        detail: newPage,
        bubbles: true,
        composed: true,
      })
    );
  }

  override render() {
    const totalPages = Math.ceil(this.totalItems / this.pageSize) || 1;
    const startItem = Math.min((this.page - 1) * this.pageSize + 1, this.totalItems);
    const endItem = Math.min(this.page * this.pageSize, this.totalItems);

    return html`
      <div class="flex items-center justify-between border-t border-zinc-200 bg-white px-4 py-3 sm:px-6">
        
        <!-- Mobile View (Simple) -->
        <div class="flex flex-1 justify-between sm:hidden">
          <button
            class="relative inline-flex items-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
            ?disabled=${this.page <= 1}
            @click=${() => this._handlePage(this.page - 1)}
          >
            Previous
          </button>
          <button
            class="relative ml-3 inline-flex items-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
            ?disabled=${this.page >= totalPages}
            @click=${() => this._handlePage(this.page + 1)}
          >
            Next
          </button>
        </div>

        <!-- Desktop View -->
        <div class="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
          <div>
            <p class="text-sm text-zinc-700">
              Showing
              <span class="font-medium">${startItem}</span>
              to
              <span class="font-medium">${endItem}</span>
              of
              <span class="font-medium">${this.totalItems}</span>
              results
            </p>
          </div>
          <div>
            <nav class="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
              <button
                class="relative inline-flex items-center rounded-l-md px-2 py-2 text-zinc-400 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                ?disabled=${this.page <= 1}
                @click=${() => this._handlePage(this.page - 1)}
              >
                <span class="sr-only">Previous</span>
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" /></svg>
              </button>
              
              <!-- Current Page Indicator -->
              <span class="relative z-10 inline-flex items-center bg-zinc-600 px-4 py-2 text-sm font-semibold text-white focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-600">
                ${this.page}
              </span>

              <button
                class="relative inline-flex items-center rounded-r-md px-2 py-2 text-zinc-400 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                ?disabled=${this.page >= totalPages}
                @click=${() => this._handlePage(this.page + 1)}
              >
                <span class="sr-only">Next</span>
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
              </button>
            </nav>
          </div>
        </div>
      </div>
    `;
  }
}
