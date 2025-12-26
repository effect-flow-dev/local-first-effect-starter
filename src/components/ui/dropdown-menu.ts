// FILE: src/components/ui/dropdown-menu.ts
import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  computePosition,
  autoUpdate,
  offset,
  flip,
  shift,
} from "@floating-ui/dom";

@customElement("dropdown-menu")
export class DropdownMenu extends LitElement {
  @state()
  private isOpen = false;

  private _cleanup?: () => void;

  // We use Shadow DOM (default), so we need internal styles for the wrapper.
  // The content inside the slots (e.g. the Delete button) remains in Light DOM
  // (in notes-page), so it retains its Tailwind styles!
  static override styles = css`
    :host {
      display: inline-block;
      position: relative;
    }

    #trigger-wrapper {
      cursor: pointer;
      display: inline-block;
    }

    #content-wrapper {
      display: none;
      position: absolute;
      top: 0;
      left: 0;
      width: max-content;
      z-index: 50;
      
      /* Replicate Tailwind 'bg-white border border-zinc-200 shadow-lg rounded-md' */
      background-color: white;
      border: 1px solid #e4e4e7;
      border-radius: 0.375rem;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      padding: 0.25rem 0;
    }

    #content-wrapper.open {
      display: block;
    }
  `;

  private get _triggerWrapper() {
    return this.shadowRoot?.getElementById("trigger-wrapper") as HTMLElement;
  }

  private get _contentWrapper() {
    return this.shadowRoot?.getElementById("content-wrapper") as HTMLElement;
  }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._handleOutsideClick);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._handleOutsideClick);
    this._cleanup?.();
  }

  private _handleOutsideClick = (e: MouseEvent) => {
    if (!this.contains(e.target as Node)) {
      this.close();
    }
  };

  private _toggle = (e: Event) => {
    e.stopPropagation();
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  };

  private open() {
    this.isOpen = true;
    
    // Wait for update so elements exist in DOM
    void this.updateComplete.then(() => {
      if (this._triggerWrapper && this._contentWrapper) {
        this._cleanup = autoUpdate(this._triggerWrapper, this._contentWrapper, () => {
          void computePosition(this._triggerWrapper, this._contentWrapper, {
            placement: "bottom-end",
            middleware: [offset(6), flip(), shift({ padding: 5 })],
          }).then(({ x, y }) => {
            Object.assign(this._contentWrapper.style, {
              left: `${x}px`,
              top: `${y}px`,
            });
          });
        });
      }
    });
  }

  private close() {
    this.isOpen = false;
    this._cleanup?.();
  }

  override render() {
    return html`
      <div id="trigger-wrapper" @click=${this._toggle}>
        <slot name="trigger"></slot>
      </div>

      <div
        id="content-wrapper"
        class="${this.isOpen ? "open" : ""}"
      >
        <slot name="content"></slot>
      </div>
    `;
  }
}
