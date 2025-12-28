import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import "../dropdown-menu";

@customElement("table-row-action")
export class TableRowAction extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  override render() {
    return html`
      <dropdown-menu>
        <button
          slot="trigger"
          class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 focus:outline-none"
        >
          <span class="sr-only">Open options</span>
          <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
        </button>

        <div slot="content" class="min-w-[160px] py-1">
          <!-- Content injected here by parent -->
          <slot></slot>
        </div>
      </dropdown-menu>
    `;
  }
}
