// FILE: src/components/pages/profile-page.ts
import { LitElement, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { Effect, Either } from "effect";
import {
  authState,
  proposeAuthAction,
} from "../../lib/client/stores/authStore";
import { NotionButton } from "../ui/notion-button";
import styles from "./ProfilePage.module.css";
import "../features/change-password-form";
import { AvatarUploadError } from "../../lib/client/errors";
import { runClientUnscoped, runClientPromise } from "../../lib/client/runtime";
import { effect, signal } from "@preact/signals-core";
import { localeState, t } from "../../lib/client/stores/i18nStore";
import {
  type ProfilePageState,
  type Action,
  INITIAL_STATE,
  update,
} from "./profile-page.logic";
import { clientLog } from "../../lib/client/clientLog";

@customElement("profile-page")
export class ProfilePage extends LitElement {
  // Signal State
  public state = signal<ProfilePageState>(INITIAL_STATE);

  private _authUnsubscribe?: () => void;
  private _disposeEffect?: () => void;

  // --- Dispatcher ---
  public dispatch(action: Action) {
    const currentState = this.state.value;
    const nextState = update(currentState, action);
    this.state.value = nextState;
    this.requestUpdate();

    // Side Effects
    // We run this unscoped to avoid blocking the UI thread or render loop
    runClientUnscoped(
      this._handleSideEffects(action, currentState).pipe(
        Effect.catchAll((err) =>
          clientLog(
            "error",
            `[profile-page] Unhandled error in side effect for ${action.type}`,
            err,
          ),
        ),
      ),
    );
  }

  private _handleSideEffects(action: Action, _prevState: ProfilePageState) {
    return Effect.gen(function* () {
      switch (action.type) {
        case "UPLOAD_AVATAR_SUCCESS": {
          // When avatar upload succeeds, we need to update the global auth store
          // so the header and other components reflect the new image immediately.
          const auth = authState.value;
          if (auth.user) {
            const updatedUser = { ...auth.user, avatar_url: action.payload };
            // ✅ FIX: Update payload structure to { user: updatedUser }
            // Preserving existing tenant context if any
            void proposeAuthAction({
              type: "SET_AUTHENTICATED",
              payload: { 
                  user: updatedUser,
                  tenant: auth.currentTenant,
                  role: auth.currentRole 
              },
            });
          }
          break;
        }
      }
    }.bind(this));
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._authUnsubscribe = authState.subscribe((newAuthState) => {
      this.dispatch({ type: "AUTH_UPDATED", payload: newAuthState });
    });
    this._disposeEffect = effect(() => {
      void localeState.value;
      this.requestUpdate();
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._authUnsubscribe?.();
    this._disposeEffect?.();
  }

  private _handleFileChange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    this.dispatch({ type: "UPLOAD_AVATAR_START" });

    const uploadEffect = Effect.gen(function* () {
      // 1. Retrieve the token
      const token = localStorage.getItem("jwt");
      if (!token) {
        return yield* Effect.fail(
          new AvatarUploadError({ message: "No authentication token found." })
        );
      }

      const formData = new FormData();
      formData.append("avatar", file);

      // 2. Attach Authorization header to the raw fetch
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch("/api/user/avatar", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          }),
        catch: (cause) =>
          new AvatarUploadError({ message: "Network request failed.", cause }),
      });

      if (response.ok) {
        return yield* Effect.tryPromise({
          try: () =>
            response.json() as Promise<{
              avatarUrl: string;
            }>,
          catch: (cause) =>
            new AvatarUploadError({
              message: "Failed to parse server response.",
              cause,
            }),
        });
      } else {
        return yield* Effect.promise(() => response.text()).pipe(
          Effect.flatMap((text) =>
            Effect.fail(
              new AvatarUploadError({ message: text || "Upload failed" }),
            ),
          ),
        );
      }
    });

    const result = await runClientPromise(Effect.either(uploadEffect));

    Either.match(result, {
      onLeft: (error) =>
        this.dispatch({ type: "UPLOAD_AVATAR_ERROR", payload: error }),
      onRight: (json) =>
        this.dispatch({
          type: "UPLOAD_AVATAR_SUCCESS",
          payload: json.avatarUrl,
        }),
    });
  };

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    const s = this.state.value;

    if (s.status === "initializing") {
      return html`<p>${t("common.loading")}</p>`;
    }

    const { auth, interaction, feedback } = s;
    const { user } = auth;

    if (!user) return html`<p>${t("common.loading")}</p>`;

    const avatarUrl =
      user.avatar_url ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}`;

    const isUploading = interaction.type === "uploading_avatar";
    const isChangingPassword = interaction.type === "changing_password";

    // Determine message styles
    const messageClass = feedback
      ? feedback.type === "success"
        ? styles.messageSuccess
        : styles.messageError
      : "";

    return html`
      <div class=${styles.container}>
        <div
          class=${styles.profileCard}
          @password-changed-success=${() =>
            this.dispatch({ type: "PASSWORD_CHANGED" })}
          @change-password-cancelled=${() =>
            this.dispatch({ type: "PASSWORD_CHANGE_CANCELLED" })}
        >
          <h2 class=${styles.title}>${t("profile.title")}</h2>
          
          ${feedback
            ? html`<div class="${styles.message} ${messageClass}">
                ${t(feedback.message) || feedback.message}
              </div>`
            : nothing}

          <div class=${styles.avatarContainer}>
            <img src=${avatarUrl} alt="Profile avatar" class=${styles.avatar} />
            <p class=${styles.email}>${user.email}</p>
          </div>
          
          <div class=${styles.uploadSection}>
            ${isChangingPassword
              ? html`<change-password-form></change-password-form>`
              : html`<div class="mt-4 flex flex-col items-center gap-4">
                  <input
                    type="file"
                    id="avatar-upload"
                    class="hidden"
                    @change=${this._handleFileChange}
                    accept="image/png, image/jpeg, image/webp, image/gif"
                  />
                  ${NotionButton({
                    children: t("profile.change_picture"),
                    onClick: () =>
                      (
                        this.querySelector("#avatar-upload") as HTMLElement
                      )?.click(),
                    loading: isUploading,
                    disabled: isUploading, // Prevent double upload
                  })}
                  ${NotionButton({
                    children: t("profile.change_password"),
                    onClick: () =>
                      this.dispatch({ type: "TOGGLE_PASSWORD_FORM" }),
                    disabled: isUploading, // Disable while uploading
                  })}
                </div>`}
          </div>
        </div>
      </div>
    `;
  }
}
