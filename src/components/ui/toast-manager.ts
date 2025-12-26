import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { effect } from "@preact/signals-core";
import { toastsState, removeToast } from "../../lib/client/stores/toastStore";

@customElement("toast-manager")
export class ToastManager extends LitElement {
  private _disposeEffect?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    this._disposeEffect = effect(() => {
      void toastsState.value;
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  // We use Shadow DOM here to ensure fixed positioning works reliably
  // regardless of parent styles, but we import Tailwind classes via a shared 
  // constructable stylesheet or just inline minimal styles for the container.
  static override styles = css`
    :host {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 100;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: none; /* Let clicks pass through empty areas */
    }

    .toast {
      pointer-events: auto;
      min-width: 300px;
      max-width: 400px;
      padding: 16px;
      border-radius: 8px;
      background: white;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      border-left: 4px solid transparent;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      animation: slideIn 0.3s ease-out forwards;
      font-family: 'Inter', sans-serif;
      font-size: 0.875rem;
      color: #18181b; /* zinc-900 */
    }

    .toast.success { border-left-color: #22c55e; }
    .toast.error { border-left-color: #ef4444; }
    .toast.warning { border-left-color: #f59e0b; }
    .toast.info { border-left-color: #3b82f6; }

    .message {
      flex: 1;
      line-height: 1.5;
    }

    .close-btn {
      color: #a1a1aa; /* zinc-400 */
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      display: flex;
    }
    .close-btn:hover { color: #71717a; }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  private _getIcon(type: string) {
    switch (type) {
      case "success": return html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
      case "error": return html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
      case "warning": return html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
      default: return html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }
  }

  override render() {
    return html`
      ${repeat(toastsState.value, (t) => t.id, (t) => html`
        <div class="toast ${t.type}">
          ${this._getIcon(t.type)}
          <div class="message">${t.message}</div>
          <button class="close-btn" @click=${() => removeToast(t.id)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `)}
    `;
  }
}
