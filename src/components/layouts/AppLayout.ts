// FILE: src/components/layouts/AppLayout.ts
import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import {
  type AuthModel,
  proposeAuthAction,
} from "../../lib/client/stores/authStore";
import { toggleSidebar } from "../../lib/client/stores/sidebarStore";
import { runClientUnscoped } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";
import { t, localeState } from "../../lib/client/stores/i18nStore";

import "../features/language-switcher";
import "./TabBar";
import "./Sidebar";
import "../ui/mobile-sidebar-backdrop";

@customElement("app-layout")
export class AppLayout extends LitElement {
  @property({ attribute: false })
  auth!: AuthModel;

  @property({ attribute: false })
  content?: TemplateResult;

  @property({ type: String })
  currentPath = "";

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

  private _handleLogout = (e: Event) => {
    e.preventDefault();
    void proposeAuthAction({ type: "LOGOUT_START" });
  };

  private _handleLinkClick(path: string) {
    return (e: Event) => {
      e.preventDefault();
      runClientUnscoped(navigate(path));
    };
  }

  private _toggleSidebarClick = (e: Event) => {
    e.preventDefault();
    toggleSidebar();
  };

  protected override createRenderRoot() {
    return this; // Light DOM for global styles
  }

  override render() {
    const isAuthenticated = this.auth?.status === "authenticated";

    // Logic to show tabs only when authenticated AND when viewing a specific note
    const showTabs = isAuthenticated && this.currentPath.startsWith("/notes/");

    const loggedInNav = html`
      <div class="flex items-center gap-4">
        <a
          href="/"
          @click=${this._handleLinkClick("/")}
          class="hidden text-sm font-medium text-zinc-600 hover:text-zinc-900 md:block"
          >${t("common.notes")}</a
        >
        <a
          href="/profile"
          @click=${this._handleLinkClick("/profile")}
          class="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >${t("common.profile")}</a
        >
        <language-switcher></language-switcher>

        <a
          href="#"
          @click=${this._handleLogout}
          class="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >${t("common.logout")}</a
        >
      </div>
    `;

    const publicNav = html`
      <div class="flex items-center gap-4">
        <language-switcher></language-switcher>
      </div>
    `;

    return html`
      <div class="flex h-screen flex-col overflow-hidden bg-zinc-50">
        <!-- Global Header -->
        <header
          class="z-10 flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 py-3"
        >
          <div class="flex items-center gap-4">
            ${isAuthenticated
              ? html`
                  <button
                    @click=${this._toggleSidebarClick}
                    class="text-zinc-500 hover:text-zinc-800"
                    title="Toggle Sidebar"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <line x1="3" y1="12" x2="21" y2="12"></line>
                      <line x1="3" y1="6" x2="21" y2="6"></line>
                      <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                  </button>
                `
              : html``}

            <a
              href="/"
              @click=${this._handleLinkClick("/")}
              class="font-bold text-zinc-900"
              >Life IO</a
            >
          </div>
          ${isAuthenticated ? loggedInNav : publicNav}
        </header>

        <!-- Main Content Area with Sidebar -->
        <div class="relative flex flex-1 min-h-0">
          ${isAuthenticated
            ? html`<mobile-sidebar-backdrop></mobile-sidebar-backdrop>`
            : ""}
          ${isAuthenticated ? html`<side-bar></side-bar>` : ""}

          <div class="flex min-w-0 flex-1 flex-col bg-white">
            ${showTabs ? html`<tab-bar class="shrink-0"></tab-bar>` : ""}
            <main class="flex-1 overflow-auto p-4">
              ${this.content}
            </main>
          </div>
        </div>
      </div>
    `;
  }
}
