// FILE: src/components/ui/mobile-sidebar-backdrop.ts
import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import {
  sidebarState,
  closeSidebar,
} from "../../lib/client/stores/sidebarStore";

@customElement("mobile-sidebar-backdrop")
export class MobileSidebarBackdrop extends LitElement {
  private _disposeEffect?: () => void;

  // We use shadow DOM, but we want the backdrop to cover the screen.
  // Fixed positioning works relative to the viewport.
  static override styles = css`
    .backdrop {
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(2px);
      z-index: 20; /* Behind sidebar (z-30) but above content */
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }

    .open {
      opacity: 1;
      pointer-events: auto;
    }

    /* Hide completely on desktop to prevent interference */
    @media (min-width: 768px) {
      .backdrop {
        display: none;
      }
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this._disposeEffect = effect(() => {
      // Trigger update when signal changes
      void sidebarState.value;
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  // ✅ FIX: Converted to arrow function to fix @typescript-eslint/unbound-method error
  private _handleClick = () => {
    closeSidebar();
  };

  override render() {
    const isOpen = sidebarState.value;
    return html`
      <div
        class="backdrop ${isOpen ? "open" : ""}"
        @click=${this._handleClick}
      ></div>
    `;
  }
}
