// FILE: src/components/layouts/TabBar.ts
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import {
  tabsState,
  activeTabIdState,
  closeTab,
  openTab,
} from "../../lib/client/stores/tabStore";
import { navigate } from "../../lib/client/router";
import { runClientUnscoped } from "../../lib/client/runtime";

@customElement("tab-bar")
export class TabBar extends LitElement {
  private _disposeEffect?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    // Re-render this component whenever the signals change
    this._disposeEffect = effect(() => {
      // ✅ FIX: Use void to mark expressions as intentionally unused
      void tabsState.value;
      void activeTabIdState.value;
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  private _handleTabClick(id: string) {
    // Explicitly call openTab to ensure store state updates immediately
    openTab(id);
    runClientUnscoped(navigate(`/notes/${id}`));
  }

  private _handleClose(e: Event, id: string) {
    e.stopPropagation(); // Prevent triggering the tab click (navigation)
    const nextPath = closeTab(id);
    if (nextPath) {
      runClientUnscoped(navigate(nextPath));
    }
  }

  /**
   * We use Light DOM to easily inherit the global Tailwind styles
   * defined in src/styles/index.css.
   */
  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const tabs = tabsState.value;
    const activeId = activeTabIdState.value;

    if (tabs.length === 0) {
      return html``;
    }

    // Base classes applied to every tab
    const baseClasses =
      "flex items-center gap-2 px-4 py-2 text-sm cursor-pointer select-none min-w-[120px] max-w-[200px] border-r border-zinc-200 transition-colors";

    // Active state classes
    const activeClasses =
      "bg-white text-zinc-900 font-medium border-t-2 border-t-zinc-900 -mt-px";

    // Inactive state classes
    const inactiveClasses = "bg-zinc-50 text-zinc-500 hover:bg-zinc-100";

    return html`
      <div
        class="flex w-full overflow-x-auto border-b border-zinc-200 bg-zinc-100"
      >
        ${tabs.map((tab) => {
          const isActive = tab.id === activeId;
          // Use string interpolation instead of classMap to avoid DOMTokenList errors with multi-class strings
          const className = `${baseClasses} ${
            isActive ? activeClasses : inactiveClasses
          }`;

          return html`
            <div
              class=${className}
              @click=${() => this._handleTabClick(tab.id)}
            >
              <span class="flex-1 truncate">${tab.title}</span>
              <button
                class="rounded p-0.5 hover:bg-zinc-200 hover:text-red-500 opacity-60 hover:opacity-100"
                @click=${(e: Event) => this._handleClose(e, tab.id)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          `;
        })}
      </div>
    `;
  }
}
