// FILE: src/lib/client/router.ts
import { Effect } from "effect";
import { html, type TemplateResult } from "lit-html";
import { clientLog } from "./clientLog";
import { LocationService } from "./LocationService";

import "../../components/pages/notes-page";
import "../../components/pages/note-page";
import "../../components/pages/login-page";
import "../../components/pages/signup-page";
import "../../components/pages/check-email-page";
import "../../components/pages/verify-email-page";
import "../../components/pages/profile-page";
import "../../components/pages/forgot-password-page";
import "../../components/pages/reset-password-page";
// ✅ NEW: Import selection page
import "../../components/pages/workspace-selection-page";

const UnauthorizedView = (): ViewResult => ({
  template: html`<div>403 Unauthorized</div>`,
});
const NotFoundView = (): ViewResult => ({
  template: html`<div>404 Not Found</div>`,
});

export interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}
export interface Route {
  pattern: RegExp;
  view: (...args: string[]) => ViewResult;
  meta: {
    requiresAuth?: boolean;
    isPublicOnly?: boolean;
  };
}
type MatchedRoute = Route & { params: string[] };
const routes: Route[] = [
  {
    pattern: /^\/$/,
    view: () => ({ template: html`<notes-page></notes-page>` }),
    meta: { requiresAuth: true },
  },
  {
    pattern: /^\/notes\/([^/]+)$/,
    view: (id: string) => ({
      template: html`<note-page .id=${id}></note-page>`,
    }),
    meta: { requiresAuth: true },
  },
  {
    pattern: /^\/login$/,
    view: () => ({ template: html`<login-page></login-page>` }),
    meta: { isPublicOnly: true },
  },
  {
    pattern: /^\/signup$/,
    view: () => ({ template: html`<signup-page></signup-page>` }),
    meta: { isPublicOnly: true },
  },
  {
    pattern: /^\/check-email$/,
    view: () => ({ template: html`<check-email-page></check-email-page>` }),
    meta: { isPublicOnly: true },
  },
  {
    pattern: /^\/verify-email\/([^/]+)$/,
    view: (token: string) => ({
      template: html`<verify-email-page .token=${token}></verify-email-page>`,
    }),
    meta: { isPublicOnly: true },
  },
  // ✅ NEW: Workspace Selection Route
  {
    pattern: /^\/select-workspace$/,
    view: () => ({ template: html`<workspace-selection-page></workspace-selection-page>` }),
    // This route does not strictly require the 'authStore' to be in 'authenticated' state 
    // in the traditional sense if we treat it as an interstitial step, 
    // but practically the user has a token. Let's mark it public to avoid the app-shell redirecting 
    // to /login automatically if the store isn't fully updated yet.
    meta: { }, 
  },
  {
    pattern: /^\/profile$/,
    view: () => ({ template: html`<profile-page></profile-page>` }),
    meta: { requiresAuth: true },
  },
  {
    pattern: /^\/forgot-password$/,
    view: () => ({
      template: html`<forgot-password-page></forgot-password-page>`,
    }),
    meta: { isPublicOnly: true },
  },
  {
    pattern: /^\/reset-password\/([^/]+)$/,
    view: (token: string) => ({
      template: html`<reset-password-page
        .token=${token}
      ></reset-password-page>`,
    }),
    meta: { isPublicOnly: true },
  },
  { pattern: /^\/unauthorized$/, view: UnauthorizedView, meta: {} },
];
export const matchRoute = (path: string): Effect.Effect<MatchedRoute> =>
  Effect.gen(function* () {
    for (const route of routes) {
      const match = path.match(route.pattern);
      if (match) {
        return { ...route, params: match.slice(1) };
      }
    }
    return { pattern: /^\/404$/, view: NotFoundView, meta: {}, params: [] };
  });
export const navigate = (
  path: string,
): Effect.Effect<void, Error, LocationService> =>
  Effect.gen(function* () {
    yield* clientLog("info", `Navigating to ${path}`, undefined, "router");
    const location = yield* LocationService;
    yield* location.navigate(path);
  });
