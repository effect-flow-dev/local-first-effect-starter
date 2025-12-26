// FILE: src/components/pages/verify-email-page.ts
import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Effect, pipe } from "effect";
import { runClientUnscoped } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";
import { proposeAuthAction } from "../../lib/client/stores/authStore";
import { api } from "../../lib/client/api";
import styles from "./LoginPage.module.css";
import { SamController } from "../../lib/client/sam-controller";
import type { PublicUser } from "../../lib/shared/schemas";

interface Model {
  status: "verifying" | "success" | "error";
  error: string | null;
}

type Action =
  | { type: "VERIFY_START" }
  | { type: "VERIFY_SUCCESS" }
  | { type: "VERIFY_ERROR"; payload: string };

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "VERIFY_START":
      return { ...model, status: "verifying", error: null };
    case "VERIFY_SUCCESS":
      return { ...model, status: "success", error: null };
    case "VERIFY_ERROR":
      return { ...model, status: "error", error: action.payload };
    default:
      return model;
  }
};

@customElement("verify-email-page")
export class VerifyEmailPage extends LitElement {
  @property({ type: String })
  token = "";

  private ctrl = new SamController<this, Model, Action>(
    this,
    { status: "verifying", error: null },
    update,
  );

  override connectedCallback() {
    super.connectedCallback();
    void (async () => {
      this.ctrl.propose({ type: "VERIFY_START" });
      await this.updateComplete;

      try {
        const { data, error } = await api.api.auth.verifyEmail.post({
          token: this.token,
        });

        if (error) {
          const errorValue = error.value;
          const errMsg =
            typeof errorValue === "object" &&
            errorValue !== null &&
            "error" in errorValue
              ? String((errorValue as { error: unknown }).error)
              : "Verification failed";
          this.ctrl.propose({ type: "VERIFY_ERROR", payload: errMsg });
        } else if (data && data.token && data.user) {
          this.ctrl.propose({ type: "VERIFY_SUCCESS" });
          
          if (typeof data.token === "string") {
             localStorage.setItem("jwt", data.token);
          }
          
          // ✅ FIX: Update payload structure to { user: ... }
          await proposeAuthAction({
            type: "SET_AUTHENTICATED",
            payload: { user: data.user as unknown as PublicUser },
          });

          // Mark floating promise as void
          void runClientUnscoped(
            pipe(
              Effect.sleep("2 seconds"),
              Effect.andThen(navigate("/")),
            ),
          );
        } else {
           this.ctrl.propose({ type: "VERIFY_ERROR", payload: "Invalid response" });
        }
      } catch (err) {
        console.error(err);
        this.ctrl.propose({ type: "VERIFY_ERROR", payload: "Network error" });
      }
    })();
  }

  override render(): TemplateResult {
    const model = this.ctrl.model;

    const renderContent = () => {
      switch (model.status) {
        case "verifying":
          return html`<div
              class="h-12 w-12 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600"
            ></div>
            <p class="mt-4 text-zinc-600">Verifying your email...</p>`;
        case "success":
          return html`<h2 class="text-2xl font-bold text-green-600">
              Success!
            </h2>
            <p class="mt-4 text-zinc-600">
              Email verified successfully! Redirecting...
            </p>`;
        case "error":
          return html`<h2 class="text-2xl font-bold text-red-600">Error</h2>
            <p class="mt-4 text-zinc-600">
              ${model.error || "An unknown error occurred."}
            </p>
            <div class="mt-6">
              <a
                href="/login"
                class=${styles.link}
                @click=${(e: Event) => {
                  e.preventDefault();
                  void runClientUnscoped(navigate("/login"));
                }}
              >
                Back to Login
              </a>
            </div>`;
      }
    };

    return html`
      <div class=${styles.container}>
        <div
          class="flex w-full max-w-md flex-col items-center rounded-lg bg-white p-8 text-center shadow-md"
        >
          ${renderContent()}
        </div>
      </div>
    `;
  }

  protected override createRenderRoot() {
    return this;
  }
}
