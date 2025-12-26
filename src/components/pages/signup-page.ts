// FILE: src/components/pages/signup-page.ts
import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { navigate } from "../../lib/client/router";
import { api } from "../../lib/client/api";
import { NotionButton } from "../ui/notion-button";
import { NotionInput } from "../ui/notion-input";
import { NotionSelect, type SelectOption } from "../ui/notion-select";
import styles from "./SignupPage.module.css";
import { SamController } from "../../lib/client/sam-controller";
import { effect } from "@preact/signals-core";
import { localeState, t } from "../../lib/client/stores/i18nStore";
import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/clientLog";

interface Model {
  email: string;
  password: string;
  confirmPassword: string;
  organizationName: string;
  workspaceName: string;
  subdomain: string;
  tenantStrategy: "schema" | "database";
  error: string | null;
  isLoading: boolean;
  isSuccess: boolean;
}

type Action =
  | { type: "UPDATE_EMAIL"; payload: string }
  | { type: "UPDATE_PASSWORD"; payload: string }
  | { type: "UPDATE_CONFIRM_PASSWORD"; payload: string }
  | { type: "UPDATE_ORG_NAME"; payload: string }
  | { type: "UPDATE_WORKSPACE_NAME"; payload: string }
  | { type: "UPDATE_SUBDOMAIN"; payload: string }
  | { type: "UPDATE_TENANT_STRATEGY"; payload: "schema" | "database" }
  | { type: "SIGNUP_START" }
  | { type: "SIGNUP_SUCCESS" }
  | { type: "SIGNUP_ERROR"; payload: string };

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "UPDATE_EMAIL":
      return { ...model, email: action.payload, error: null };
    case "UPDATE_PASSWORD":
      return { ...model, password: action.payload, error: null };
    case "UPDATE_CONFIRM_PASSWORD":
      return { ...model, confirmPassword: action.payload, error: null };
    case "UPDATE_ORG_NAME":
      return { ...model, organizationName: action.payload, error: null };
    case "UPDATE_WORKSPACE_NAME":
      return { ...model, workspaceName: action.payload, error: null };
    case "UPDATE_SUBDOMAIN":
      return { ...model, subdomain: action.payload, error: null };
    case "UPDATE_TENANT_STRATEGY":
      return { ...model, tenantStrategy: action.payload, error: null };
    case "SIGNUP_START":
      return { ...model, isLoading: true, error: null };
    case "SIGNUP_SUCCESS":
      return { ...model, isLoading: false, isSuccess: true };
    case "SIGNUP_ERROR":
      return { ...model, isLoading: false, error: action.payload };
  }
};

@customElement("signup-page")
export class SignupPage extends LitElement {
  private ctrl = new SamController<this, Model, Action>(
    this,
    {
      email: "",
      password: "",
      confirmPassword: "",
      organizationName: "",
      workspaceName: "",
      subdomain: "",
      tenantStrategy: "schema",
      error: null,
      isLoading: false,
      isSuccess: false,
    },
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
    
    // ✅ ADDED: Debug log to confirm submission is passing browser validation
    void runClientUnscoped(clientLog("info", "[SignupPage] Form Submitted. Processing..."));

    this.ctrl.propose({ type: "SIGNUP_START" });
    await this.updateComplete;

    const { email, password, confirmPassword, tenantStrategy, subdomain, organizationName, workspaceName } =
      this.ctrl.model;

    void runClientUnscoped(
      clientLog("info", "[SignupPage] Submitting payload...", {
        email,
        subdomain,
        tenantStrategy,
      })
    );

    if (password !== confirmPassword) {
      this.ctrl.propose({
        type: "SIGNUP_ERROR",
        payload: t("auth.passwords_do_not_match"),
      });
      return;
    }

    try {
      const { error } = await api.api.auth.signup.post({
        email,
        password,
        tenantStrategy,
        subdomain,
        organizationName,
        workspaceName,
      });

      if (error) {
        const errorValue = error.value;
        const errMsg =
          typeof errorValue === "object" &&
          errorValue !== null &&
          "error" in errorValue
            ? String((errorValue as { error: unknown }).error)
            : "Signup failed";
        
        void runClientUnscoped(
            clientLog("error", "[SignupPage] API Error response", errMsg)
        );
        this.ctrl.propose({ type: "SIGNUP_ERROR", payload: errMsg });
      } else {
        void runClientUnscoped(clientLog("info", "[SignupPage] Signup success!"));
        this.ctrl.propose({ type: "SIGNUP_SUCCESS" });
        runClientUnscoped(navigate("/check-email"));
      }
    } catch (err) {
      console.error(err);
      this.ctrl.propose({ type: "SIGNUP_ERROR", payload: "Network error" });
    }
  };

  override render(): TemplateResult {
    const model = this.ctrl.model;

    const strategyOptions: SelectOption[] = [
      { label: t("auth.strategy_schema"), value: "schema" },
      { label: t("auth.strategy_database"), value: "database" },
    ];

    return html`
      <div class=${styles.container}>
        <div class=${styles.formWrapper}>
          <h2 class=${styles.title}>${t("auth.signup_title")}</h2>
          <form @submit=${this._handleSubmit}>
            <div class="space-y-4">
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
              
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  ${NotionInput({
                    id: "organizationName",
                    label: "Organization Name",
                    type: "text",
                    value: model.organizationName,
                    placeholder: "e.g. Acme Corp",
                    onInput: (e) =>
                      this.ctrl.propose({
                        type: "UPDATE_ORG_NAME",
                        payload: (e.target as HTMLInputElement).value,
                      }),
                    required: true,
                  })}
                  ${NotionInput({
                    id: "workspaceName",
                    label: "Workspace Name",
                    type: "text",
                    value: model.workspaceName,
                    placeholder: "e.g. Engineering",
                    onInput: (e) =>
                      this.ctrl.propose({
                        type: "UPDATE_WORKSPACE_NAME",
                        payload: (e.target as HTMLInputElement).value,
                      }),
                    required: true,
                  })}
              </div>

              ${NotionInput({
                id: "subdomain",
                label: t("auth.subdomain_label"),
                type: "text",
                value: model.subdomain,
                placeholder: t("auth.subdomain_placeholder"),
                onInput: (e) =>
                  this.ctrl.propose({
                    type: "UPDATE_SUBDOMAIN",
                    payload: (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
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
              ${NotionInput({
                id: "confirmPassword",
                label: t("auth.confirm_password_label"),
                type: "password",
                value: model.confirmPassword,
                onInput: (e) =>
                  this.ctrl.propose({
                    type: "UPDATE_CONFIRM_PASSWORD",
                    payload: (e.target as HTMLInputElement).value,
                  }),
                required: true,
              })}
              ${NotionSelect({
                id: "tenantStrategy",
                label: t("auth.tenant_strategy_label"),
                value: model.tenantStrategy,
                options: strategyOptions,
                onChange: (e) =>
                  this.ctrl.propose({
                    type: "UPDATE_TENANT_STRATEGY",
                    payload: (e.target as HTMLSelectElement)
                      .value as "schema" | "database",
                  }),
              })}
            </div>

            ${model.error
              ? html`<div class=${styles.errorText}>${model.error}</div>`
              : nothing}

            <div class="mt-6">
              ${NotionButton({
                children: model.isLoading
                  ? t("auth.creating_account")
                  : t("auth.create_account_button"),
                type: "submit",
                loading: model.isLoading,
              })}
            </div>
          </form>

          <div class="mt-4 text-center text-sm">
            <a
              href="/login"
              class=${styles.link}
              @click=${(e: Event) => {
                e.preventDefault();
                runClientUnscoped(navigate("/login"));
              }}
            >
              ${t("auth.has_account")}
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
