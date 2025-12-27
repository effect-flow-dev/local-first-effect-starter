// FILE: src/components/pages/profile-page.logic.ts
import type { AuthModel } from "../../lib/client/stores/authStore";
import { AvatarUploadError } from "../../lib/client/errors";

// --- State Definitions ---

export interface Feedback {
  readonly type: "success" | "error";
  readonly message: string;
}

export type ProfileInteraction =
  | { type: "view" }
  | { type: "uploading_avatar" }
  | { type: "changing_password" }
  // ✅ NEW: Enabling notifications
  | { type: "enabling_notifications" };

export interface InitializingState {
  readonly status: "initializing";
}

export interface ReadyState {
  readonly status: "ready";
  readonly auth: AuthModel;
  readonly interaction: ProfileInteraction;
  readonly feedback: Feedback | null;
}

export type ProfilePageState = InitializingState | ReadyState;

export const INITIAL_STATE: ProfilePageState = { status: "initializing" };

// --- Actions ---

export type Action =
  | { type: "AUTH_UPDATED"; payload: AuthModel }
  | { type: "UPLOAD_AVATAR_START" }
  | { type: "UPLOAD_AVATAR_SUCCESS"; payload: string } 
  | { type: "UPLOAD_AVATAR_ERROR"; payload: AvatarUploadError }
  | { type: "TOGGLE_PASSWORD_FORM" }
  | { type: "PASSWORD_CHANGED" }
  | { type: "PASSWORD_CHANGE_CANCELLED" }
  // ✅ NEW: Notification Actions
  | { type: "ENABLE_NOTIFICATIONS_START" }
  | { type: "ENABLE_NOTIFICATIONS_SUCCESS" }
  | { type: "ENABLE_NOTIFICATIONS_ERROR"; payload: string };

// --- Reducer ---

export const update = (
  state: ProfilePageState,
  action: Action,
): ProfilePageState => {
  switch (action.type) {
    case "AUTH_UPDATED": {
      if (state.status === "initializing") {
        return {
          status: "ready",
          auth: action.payload,
          interaction: { type: "view" },
          feedback: null,
        };
      }
      return {
        ...state,
        auth: action.payload,
      };
    }

    case "UPLOAD_AVATAR_START":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "uploading_avatar" },
        feedback: null,
      };

    case "UPLOAD_AVATAR_SUCCESS":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "view" },
        feedback: { type: "success", message: "Avatar updated successfully!" },
      };

    case "UPLOAD_AVATAR_ERROR":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "view" },
        feedback: { type: "error", message: action.payload.message },
      };

    case "TOGGLE_PASSWORD_FORM":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction:
          state.interaction.type === "changing_password"
            ? { type: "view" }
            : { type: "changing_password" },
        feedback: null,
      };

    case "PASSWORD_CHANGED":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "view" },
        feedback: {
          type: "success",
          message: "Password changed successfully!",
        },
      };

    case "PASSWORD_CHANGE_CANCELLED":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "view" },
        feedback: null,
      };

    // ✅ NEW: Notifications Logic
    case "ENABLE_NOTIFICATIONS_START":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "enabling_notifications" },
        feedback: null,
      };

    case "ENABLE_NOTIFICATIONS_SUCCESS":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "view" },
        feedback: { type: "success", message: "Push notifications enabled!" },
      };

    case "ENABLE_NOTIFICATIONS_ERROR":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "view" },
        feedback: { type: "error", message: action.payload },
      };

    default:
      return state;
  }
};
