// FILE: src/components/features/change-password-form.ts
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { NotionButton } from "../ui/notion-button";
import { NotionInput } from "../ui/notion-input";
import { api } from "../../lib/client/api";
import { effect } from "@preact/signals-core";
import { localeState, t } from "../../lib/client/stores/i18nStore";

interface Model {
  status: "idle" | "loading" | "error";
  message: string | null;
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

@customElement("change-password-form")
export class ChangePasswordForm extends LitElement {
  @state()
  private model: Model = {
    status: "idle",
    message: null,
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  };

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

  private _update(partial: Partial<Model>) {
    this.model = { ...this.model, ...partial };
  }

  private _onSubmit = async (e: Event) => {
    e.preventDefault();
    this._update({ status: "loading", message: null });

    const { oldPassword, newPassword, confirmPassword } = this.model;

    if (newPassword !== confirmPassword) {
      this._update({
        status: "error",
        message: t("auth.passwords_do_not_match"),
      });
      return;
    }

    try {
      const token = localStorage.getItem("jwt");
      const { error } = await api.api.auth["change-password"].post(
        { oldPassword, newPassword },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (error) {
        throw new Error(error.value ? JSON.stringify(error.value) : "Failed to change password");
      }

      this._update({ status: "idle" });
      this.dispatchEvent(
        new CustomEvent("password-changed-success", {
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      this._update({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  private _onCancel = () => {
    this.dispatchEvent(
      new CustomEvent("change-password-cancelled", {
        bubbles: true,
        composed: true,
      })
    );
  };

  override render() {
    return html`
      <form @submit=${this._onSubmit} class="mt-6 space-y-4 text-left">
        ${NotionInput({
          id: "old-password",
          label: t("auth.old_password_label"),
          type: "password",
          value: this.model.oldPassword,
          onInput: (e) =>
            this._update({
              oldPassword: (e.target as HTMLInputElement).value,
            }),
          required: true,
        })}
        ${NotionInput({
          id: "new-password",
          label: t("auth.new_password_label"),
          type: "password",
          value: this.model.newPassword,
          onInput: (e) =>
            this._update({
              newPassword: (e.target as HTMLInputElement).value,
            }),
          required: true,
        })}
        ${NotionInput({
          id: "confirm-password",
          label: t("auth.confirm_password_label"),
          type: "password",
          value: this.model.confirmPassword,
          onInput: (e) =>
            this._update({
              confirmPassword: (e.target as HTMLInputElement).value,
            }),
          required: true,
        })}
        ${this.model.message
          ? html`<div class="text-sm text-red-500">${this.model.message}</div>`
          : nothing}
        <div class="flex items-center gap-4 pt-2">
          ${NotionButton({
            children: t("auth.save_password"),
            type: "submit",
            loading: this.model.status === "loading",
            disabled: this.model.status === "loading",
          })}
          <button
            type="button"
            @click=${this._onCancel}
            class="text-sm font-medium text-zinc-600 hover:text-zinc-500"
          >
            ${t("common.cancel")}
          </button>
        </div>
      </form>
    `;
  }

  protected override createRenderRoot() {
    return this;
  }
}
