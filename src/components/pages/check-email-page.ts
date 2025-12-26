// src/components/pages/check-email-page.ts
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { runClientUnscoped } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";
import styles from "./LoginPage.module.css"; // Reuse login styles

@customElement("check-email-page")
export class CheckEmailPage extends LitElement {
  override render() {
    return html`
      <div class=${styles.container}>
        <div class=${styles.formWrapper}>
          <h2 class=${styles.title}>Check Your Email</h2>
          <p class="text-center text-zinc-600">
            We've sent a verification link to your email address. Please click
            the link to complete your registration.
          </p>
          <div class="mt-6 text-center">
            <a
              href="/login"
              class=${styles.link}
              @click=${(e: Event) => {
                e.preventDefault();
                runClientUnscoped(navigate("/login"));
              }}
              >Return to Login</a
            >
          </div>
        </div>
      </div>
    `;
  }

  protected override createRenderRoot() {
    return this;
  }
}
