import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SortState } from "../../../lib/client/controllers/table-controller";

@customElement("table-header")
export class TableHeader extends LitElement {
  @property({ type: String }) label = "";
  @property({ type: String }) sortKey = "";
  
  // ✅ FIX: Use 'unknown' instead of 'any'
  @property({ type: Object }) currentSort: SortState<unknown> = { field: null, direction: "asc" };

  protected override createRenderRoot() {
    return this;
  }

  // ✅ FIX: Arrow function for binding 'this'
  private _handleClick = () => {
    this.dispatchEvent(
      new CustomEvent("sort", {
        detail: this.sortKey,
        bubbles: true,
        composed: true,
      })
    );
  };

  override render() {
    const isActive = this.currentSort.field === this.sortKey;
    const direction = this.currentSort.direction;

    return html`
      <div 
        class="group flex cursor-pointer items-center gap-1 hover:text-zinc-900 ${isActive ? 'text-zinc-900 font-semibold' : 'text-zinc-500'}"
        @click=${this._handleClick}
      >
        <span>${this.label}</span>
        
        <!-- Icons -->
        <span class="flex h-4 w-4 items-center justify-center text-zinc-400 transition-colors group-hover:text-zinc-600">
          ${isActive 
            ? (direction === 'asc' 
                ? html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`
                : html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`)
            : html`<svg class="opacity-0 transition-opacity group-hover:opacity-50" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>`
          }
        </span>
      </div>
    `;
  }
}
