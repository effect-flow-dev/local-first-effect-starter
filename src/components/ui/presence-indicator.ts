// FILE: src/components/ui/presence-indicator.ts
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import { presenceState } from "../../lib/client/stores/presenceStore";
import { authState } from "../../lib/client/stores/authStore";

@customElement("presence-indicator")
export class PresenceIndicator extends LitElement {
  @property({ type: String }) blockId = "";

  private _disposeEffect?: () => void;

  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: -4px; /* Overlap effect */
      pointer-events: none; /* Don't block clicks to the editor */
    }

    .avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: bold;
      color: white;
      text-transform: uppercase;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      position: relative;
      transition: transform 0.2s ease;
    }

    .avatar:hover {
      z-index: 10;
      transform: translateY(-2px);
    }

    /* Typing indicator dot */
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 1px solid white;
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this._disposeEffect = effect(() => {
      // Subscribe to signal changes
      void presenceState.value;
      void authState.value;
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  override render() {
    if (!this.blockId) return nothing;

    const allUsers = presenceState.value[this.blockId] || [];
    const currentUser = authState.value.user;

    // Filter out self
    const remoteUsers = allUsers.filter(
      (u) => u.userId !== currentUser?.id
    );

    if (remoteUsers.length === 0) return nothing;

    // Limit to showing 3 avatars to avoid clutter
    const visibleUsers = remoteUsers.slice(0, 3);
    const overflow = remoteUsers.length - 3;

    return html`
      ${visibleUsers.map(
        (u) => html`
          <div
            class="avatar"
            style="background-color: ${u.color};"
            title="User ${u.userId}"
          >
            ${u.userId.slice(0, 2)}
          </div>
        `
      )}
      ${overflow > 0
        ? html`
            <div
              class="avatar"
              style="background-color: #71717a; font-size: 9px;"
            >
              +${overflow}
            </div>
          `
        : nothing}
    `;
  }
}
