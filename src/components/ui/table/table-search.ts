import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("table-search")
export class TableSearch extends LitElement {
  @property({ type: String }) value = "";
  @property({ type: String }) placeholder = "Search...";
  
  // Debounce delay in ms
  @property({ type: Number }) delay = 300;

  private _timer?: ReturnType<typeof setTimeout>;

  protected override createRenderRoot() {
    return this; // Light DOM for Tailwind
  }

  // ✅ FIX: Arrow function for binding 'this'
  private _handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const val = target.value;
    
    // Update local value immediately for UI responsiveness
    this.value = val;

    if (this._timer) clearTimeout(this._timer);

    this._timer = setTimeout(() => {
      this.dispatchEvent(
        new CustomEvent("search", {
          detail: val,
          bubbles: true,
          composed: true,
        })
      );
    }, this.delay);
  };

  override render() {
    return html`
      <div class="relative max-w-sm">
        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <svg class="h-4 w-4 text-zinc-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </div>
        <input
          type="text"
          class="block w-full rounded-md border border-zinc-300 bg-white py-2 pl-10 pr-3 text-sm placeholder-zinc-500 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          .value=${this.value}
          .placeholder=${this.placeholder}
          @input=${this._handleInput}
        />
      </div>
    `;
  }
}
