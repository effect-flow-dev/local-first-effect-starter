// FILE: src/components/ui/confirm-dialog.ts
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { NotionButton } from "./notion-button";
import { effect } from "@preact/signals-core";
import { localeState, t } from "../../lib/client/stores/i18nStore";

@customElement("confirm-dialog")
export class ConfirmDialog extends LitElement {
  @property({ type: Boolean })
  open = false;

  @property({ type: String })
  heading = "Confirm Action";

  @property({ type: String })
  description = "Are you sure you want to do this?";

  @property({ type: String })
  confirmText = "";

  @property({ type: String })
  cancelText = "";

  @query("dialog")
  private _dialog!: HTMLDialogElement;

  private _disposeEffect?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    this._disposeEffect = effect(() => {
      void localeState.value;
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  override updated(changedProperties: PropertyValues<this>) {
    if (changedProperties.has("open")) {
      if (this.open) {
        this._dialog.showModal();
      } else {
        this._dialog.close();
      }
    }
  }

  private _handleConfirm = () => {
    this.dispatchEvent(
      new CustomEvent("confirm", { bubbles: true, composed: true }),
    );
  };

  private _handleCancel = () => {
    this.dispatchEvent(
      new CustomEvent("cancel", { bubbles: true, composed: true }),
    );
  };

  private _handleNativeClose = () => {
    if (!this._dialog.open && this.open) {
      this._handleCancel();
    }
  };

  private _handleBackdropClick = (e: MouseEvent) => {
    const rect = this._dialog.getBoundingClientRect();
    const isInDialog =
      rect.top <= e.clientY &&
      e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX &&
      e.clientX <= rect.left + rect.width;

    if (!isInDialog) {
      this._handleCancel();
    }
  };

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const confirmLabel = this.confirmText || t("common.confirm");
    const cancelLabel = this.cancelText || t("common.cancel");

    return html`
      <dialog
        @close=${this._handleNativeClose}
        @click=${this._handleBackdropClick}
        class="m-auto backdrop:bg-zinc-900/20 backdrop:backdrop-blur-sm open:animate-in open:fade-in-0 open:zoom-in-95 w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-xl outline-none"
      >
        <h3 class="text-lg font-semibold text-zinc-900">${this.heading}</h3>
        <p class="mt-2 text-sm text-zinc-500">${this.description}</p>

        <div class="mt-6 flex justify-end gap-3">
          <button
            @click=${this._handleCancel}
            class="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
          >
            ${cancelLabel}
          </button>
          ${NotionButton({
            children: confirmLabel,
            onClick: () => this._handleConfirm(),
            type: "button",
          })}
        </div>
      </dialog>
    `;
  }
}
