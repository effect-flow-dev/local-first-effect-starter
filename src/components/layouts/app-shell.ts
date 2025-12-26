// FILE: src/components/layouts/app-shell.ts
import { render, html } from "lit-html";
import { Stream, Effect, Fiber } from "effect";
import { appStateStream } from "../../lib/client/lifecycle";
import { matchRoute, navigate } from "../../lib/client/router";
import "./AppLayout";
import "../ui/toast-manager"; // ✅ Import Global Toast Manager
import { clientLog } from "../../lib/client/clientLog";
import { runClientPromise, runClientUnscoped } from "../../lib/client/runtime";
import { type AuthModel } from "../../lib/client/stores/authStore";
import { openTab } from "../../lib/client/stores/tabStore";
import { t } from "../../lib/client/stores/i18nStore";

const processStateChange = (
  appRoot: HTMLElement,
  { path, auth }: { path: string; auth: AuthModel },
) =>
  Effect.gen(function* () {
    yield* clientLog("info", "[app-shell] processStateChange triggered", {
      path,
      authStatus: auth.status,
    });

    // 1. Loading State (Global)
    if (auth.status === "initializing" || auth.status === "authenticating") {
      yield* clientLog("debug", "[app-shell] Rendering loading state.");
      const loader = html`
        <div class="flex min-h-screen items-center justify-center">
          <p>${t("common.loading")}</p>
        </div>
        <!-- ✅ Ensure Toast Manager is active even during loading -->
        <toast-manager></toast-manager>
      `;
      return yield* Effect.sync(() => render(loader, appRoot));
    }

    const route = yield* matchRoute(path);

    // 2. Auth Guards
    if (route.meta.requiresAuth && auth.status === "unauthenticated") {
      yield* clientLog(
        "warn",
        "[app-shell] Route requires auth, but user is unauthenticated. Navigating to /login.",
      );
      return yield* navigate("/login");
    }

    if (auth.status === "authenticated" && route.meta.isPublicOnly) {
      yield* clientLog(
        "warn",
        `[app-shell] Route is public-only, but user is authenticated. Navigating to /.`,
      );
      return yield* navigate("/");
    }

    // 3. Tab Management Logic
    if (auth.status === "authenticated" && path.startsWith("/notes/")) {
      const noteId = route.params[0];
      if (noteId) {
        yield* Effect.sync(() => openTab(noteId));
      }
    }

    yield* clientLog("debug", "[app-shell] Rendering matched route view:", {
      pattern: route.pattern.toString(),
    });

    const { template: pageTemplate } = route.view(...route.params);

    // 4. Main Render
    // We mount <toast-manager> here at the root level so it sits above all layouts/pages
    yield* Effect.sync(() =>
      render(
        html`
          <app-layout 
            .auth=${auth} 
            .content=${pageTemplate}
            .currentPath=${path}
          ></app-layout>
          <!-- ✅ Global Toast Manager -->
          <toast-manager></toast-manager>
        `,
        appRoot,
      ),
    );

    yield* clientLog(
      "info",
      `Successfully rendered view for ${path}`,
      auth.user?.id,
      "AppShell:render",
    );
  });

export class AppShell extends HTMLElement {
  private mainFiber?: Fiber.RuntimeFiber<void, unknown>;

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    const mainAppStream = appStateStream.pipe(
      Stream.flatMap(
        (state) => Stream.fromEffect(processStateChange(this, state)),
        { switch: true },
      ),
    );
    this.mainFiber = runClientUnscoped(Stream.runDrain(mainAppStream));
    runClientUnscoped(
      clientLog("info", "<app-shell> connected. Main app stream started."),
    );
  }

  disconnectedCallback() {
    runClientUnscoped(
      clientLog("warn", "<app-shell> disconnected. Interrupting main fiber."),
    );
    if (this.mainFiber) {
      void runClientPromise(Fiber.interrupt(this.mainFiber));
    }
  }
}

customElements.define("app-shell", AppShell);
