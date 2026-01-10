// FILE: src/components/pages/login-page.ts
import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { navigate } from "../../lib/client/router";
import { proposeAuthAction } from "../../lib/client/stores/authStore";
import { api } from "../../lib/client/api";
import { NotionButton } from "../ui/notion-button";
import { NotionInput } from "../ui/notion-input";
import styles from "./LoginPage.module.css";
import { SamController } from "../../lib/client/sam-controller";
import { effect } from "@preact/signals-core";
import { localeState, t } from "../../lib/client/stores/i18nStore";
import { runClientUnscoped } from "../../lib/client/runtime";
import type { PublicUser } from "../../lib/shared/schemas";

interface Model {
  email: string;
  password: string;
  error: string | null;
  isLoading: boolean;
}

type Action =
  | { type: "UPDATE_EMAIL"; payload: string }
  | { type: "UPDATE_PASSWORD"; payload: string }
  | { type: "LOGIN_START" }
  | { type: "LOGIN_SUCCESS" }
  | { type: "LOGIN_ERROR"; payload: string };

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "UPDATE_EMAIL":
      return { ...model, email: action.payload, error: null };
    case "UPDATE_PASSWORD":
      return { ...model, password: action.payload, error: null };
    case "LOGIN_START":
      return { ...model, isLoading: true, error: null };
    case "LOGIN_SUCCESS":
      return { ...model, isLoading: false };
    case "LOGIN_ERROR":
      return { ...model, isLoading: false, error: action.payload };
  }
};

@customElement("login-page")
export class LoginPage extends LitElement {
  private ctrl = new SamController<this, Model, Action>(
    this,
    { email: "", password: "", error: null, isLoading: false },
    update,
  );

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

  private _handleSubmit = async (e: Event) => {
    e.preventDefault();
    this.ctrl.propose({ type: "LOGIN_START" });
    await this.updateComplete;

    const { email, password } = this.ctrl.model;

    try {
      const response = await api.api.auth.login.post({
        email,
        password,
      });

      const { data, error } = response;

      if (error) {
        const errorValue = error.value;
        const errMsg =
          typeof errorValue === "object" &&
          errorValue !== null &&
          "error" in errorValue
            ? String((errorValue as { error: unknown }).error)
            : "Login failed";
        this.ctrl.propose({ type: "LOGIN_ERROR", payload: errMsg });
        return;
      }

      // Explicitly check for successful payload structure
      if (data && 'token' in data && 'user' in data && data.token) {
        this.ctrl.propose({ type: "LOGIN_SUCCESS" });
        
        const user = data.user as unknown as PublicUser;
        const token = data.token;

        // Save JWT immediately
        localStorage.setItem("jwt", token);

        // --- AUTH SUCCESS ---
        // In the isolated architecture, if we successfully logged in, 
        // it means we are already on the correct tenant subdomain.
        // We do not support "Global" login anymore.
        
        // ✅ FIX: Update payload structure to { user }
        await proposeAuthAction({
          type: "SET_AUTHENTICATED",
          payload: { user },
        });
        
        runClientUnscoped(navigate("/"));
      } else {
        // Handle case where server returns explicit error object in 200 OK (if configured that way)
        // or unexpected data shape
        this.ctrl.propose({
          type: "LOGIN_ERROR",
          payload: (data && 'error' in data) ? (data as { error: string }).error : "Invalid response from server",
        });
      }
    } catch (err) {
        console.error("Login exception:", err);
        this.ctrl.propose({ type: "LOGIN_ERROR", payload: "Network error" });
    }
  };

  override render(): TemplateResult {
    const model = this.ctrl.model;
    return html`
      <div class=${styles.container}>
        <div class=${styles.formWrapper}>
          <h2 class=${styles.title}>${t("auth.login_title")}</h2>
          <form @submit=${this._handleSubmit}>
            ${NotionInput({
              id: "email",
              label: t("auth.email_label"),
              type: "email",
              value: model.email,
              onInput: (e) =>
                this.ctrl.propose({
                  type: "UPDATE_EMAIL",
                  payload: (e.target as HTMLInputElement).value,
                }),
              required: true,
            })}
            ${NotionInput({
              id: "password",
              label: t("auth.password_label"),
              type: "password",
              value: model.password,
              onInput: (e) =>
                this.ctrl.propose({
                  type: "UPDATE_PASSWORD",
                  payload: (e.target as HTMLInputElement).value,
                }),
              required: true,
            })}
            ${model.error
              ? html`<div class=${styles.errorText}>${model.error}</div>`
              : nothing}
            <div class="mt-6">
              ${NotionButton({
                children: model.isLoading
                  ? t("auth.logging_in")
                  : t("auth.login_button"),
                type: "submit",
                loading: model.isLoading,
              })}
            </div>
          </form>
          <div class="mt-4 text-center text-sm">
            <a
              href="/signup"
              class=${styles.link}
              @click=${(e: Event) => {
                e.preventDefault();
                runClientUnscoped(navigate("/signup"));
              }}
            >
              ${t("auth.no_account")}
            </a>
          </div>
        </div>
      </div>
    `;
  }
  protected override createRenderRoot() {
    return this;
  }
}
