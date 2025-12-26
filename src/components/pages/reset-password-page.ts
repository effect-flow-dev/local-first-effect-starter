// FILE: src/components/pages/reset-password-page.ts
import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Effect, pipe } from "effect";
import { runClientUnscoped } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";
import { api } from "../../lib/client/api";
import { NotionButton } from "../ui/notion-button";
import { NotionInput } from "../ui/notion-input";
import styles from "./LoginPage.module.css";
import { SamController } from "../../lib/client/sam-controller";

interface Model {
  newPassword: string;
  confirmPassword: string;
  error: string | null;
  isLoading: boolean;
  isSuccess: boolean;
}

type Action =
  | { type: "UPDATE_NEW_PASSWORD"; payload: string }
  | { type: "UPDATE_CONFIRM_PASSWORD"; payload: string }
  | { type: "RESET_START" }
  | { type: "RESET_SUCCESS" }
  | { type: "RESET_ERROR"; payload: string };

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "UPDATE_NEW_PASSWORD":
      return { ...model, newPassword: action.payload, error: null };
    case "UPDATE_CONFIRM_PASSWORD":
      return { ...model, confirmPassword: action.payload, error: null };
    case "RESET_START":
      return { ...model, isLoading: true, error: null };
    case "RESET_SUCCESS":
      return { ...model, isLoading: false, isSuccess: true };
    case "RESET_ERROR":
      return { ...model, isLoading: false, error: action.payload };
    default:
      return model;
  }
};

@customElement("reset-password-page")
export class ResetPasswordPage extends LitElement {
  @property({ type: String })
  token = "";

  private ctrl = new SamController<this, Model, Action>(
    this,
    {
      newPassword: "",
      confirmPassword: "",
      error: null,
      isLoading: false,
      isSuccess: false,
    },
    update,
  );

  private _handleSubmit = async (e: Event) => {
    e.preventDefault();
    this.ctrl.propose({ type: "RESET_START" });
    await this.updateComplete;

    const { newPassword, confirmPassword } = this.ctrl.model;

    if (newPassword !== confirmPassword) {
       this.ctrl.propose({ type: "RESET_ERROR", payload: "Passwords do not match" });
       return;
    }

    try {
      const { error } = await api.api.auth.resetPassword.post({ token: this.token, newPassword });

      if (error) {
        const errorValue = error.value;
        const errMsg = typeof errorValue === 'object' && errorValue && 'error' in errorValue 
            ? String((errorValue as { error: unknown }).error)
            : "Reset failed";
        this.ctrl.propose({ type: "RESET_ERROR", payload: errMsg });
      } else {
        this.ctrl.propose({ type: "RESET_SUCCESS" });
        runClientUnscoped(
          pipe(
            Effect.sleep("2 seconds"),
            Effect.andThen(navigate("/login")),
          ),
        );
      }
    } catch (err) {
      console.error(err);
      this.ctrl.propose({ type: "RESET_ERROR", payload: "Network error" });
    }
  };

  override render(): TemplateResult {
    const model = this.ctrl.model;

    if (model.isSuccess) {
      return html`
        <div class=${styles.container}>
          <div class=${styles.formWrapper}>
            <h2 class="text-2xl font-bold text-green-600">Success!</h2>
            <p class="mt-4 text-zinc-600">
              Your password has been reset. Redirecting you to the login page...
            </p>
          </div>
        </div>
      `;
    }

    return html`
      <div class=${styles.container}>
        <div class=${styles.formWrapper}>
          <h2 class=${styles.title}>Choose a New Password</h2>
          <form @submit=${this._handleSubmit}>
            <div class="space-y-4">
              ${NotionInput({
                id: "newPassword",
                label: "New Password",
                type: "password",
                value: model.newPassword,
                onInput: (e) =>
                  this.ctrl.propose({
                    type: "UPDATE_NEW_PASSWORD",
                    payload: (e.target as HTMLInputElement).value,
                  }),
                required: true,
              })}
              ${NotionInput({
                id: "confirmPassword",
                label: "Confirm New Password",
                type: "password",
                value: model.confirmPassword,
                onInput: (e) =>
                  this.ctrl.propose({
                    type: "UPDATE_CONFIRM_PASSWORD",
                    payload: (e.target as HTMLInputElement).value,
                  }),
                required: true,
              })}
            </div>

            ${model.error
              ? html`<div class=${styles.errorText}>${model.error}</div>`
              : nothing}

            <div class="mt-6">
              ${NotionButton({
                children: model.isLoading ? "Saving..." : "Save Password",
                type: "submit",
                loading: model.isLoading,
              })}
            </div>
          </form>
        </div>
      </div>
    `;
  }

  protected override createRenderRoot() {
    return this;
  }
}
