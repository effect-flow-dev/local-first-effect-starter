// FILE: src/lib/client/stores/authStore.ts
import { signal } from "@preact/signals-core";
import type { PublicUser } from "../../shared/schemas";
import { api } from "../api";
import { navigate } from "../router";
import { runClientPromise } from "../runtime";

// Tenant Context Types
export interface TenantContext {
  id: string;
  name: string;
  subdomain: string;
}

export type UserRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';

export interface AuthModel {
  readonly status:
    | "initializing"
    | "unauthenticated"
    | "authenticating"
    | "authenticated";
  readonly user: PublicUser | null;
  readonly currentTenant: TenantContext | null;
  readonly currentRole: UserRole | null;
}

export const authState = signal<AuthModel>({
  status: "initializing",
  user: null,
  currentTenant: null,
  currentRole: null,
});

type AuthenticatedPayload = {
    user: PublicUser;
    tenant?: TenantContext | null;
    role?: UserRole | null;
}

type AuthAction =
  | { type: "AUTH_CHECK_START" }
  | { type: "LOGOUT_START" }
  | { type: "LOGOUT_SUCCESS" }
  | { type: "SET_AUTHENTICATED"; payload: AuthenticatedPayload }
  | { type: "SET_UNAUTHENTICATED" };

const update = (model: AuthModel, action: AuthAction): AuthModel => {
  switch (action.type) {
    case "AUTH_CHECK_START":
      return { ...model, status: "authenticating" };
    case "LOGOUT_START":
      return { ...model, status: "authenticating" };
    case "SET_AUTHENTICATED":
      return { 
          status: "authenticated", 
          user: action.payload.user,
          currentTenant: action.payload.tenant || null,
          currentRole: action.payload.role || null
      };
    case "LOGOUT_SUCCESS":
    case "SET_UNAUTHENTICATED":
      return { 
          status: "unauthenticated", 
          user: null,
          currentTenant: null,
          currentRole: null 
      };
    default:
      return model;
  }
};

interface RawUserPayload {
  id: string;
  email: string;
  avatar_url?: string | null;
  permissions?: string[];
  email_verified?: boolean;
  created_at?: string;
}

interface AuthMeResponse {
  user: PublicUser;
  tenant?: TenantContext;
  role?: UserRole;
}

export const proposeAuthAction = async (action: AuthAction): Promise<void> => {
  authState.value = update(authState.value, action);

  try {
    switch (action.type) {
      case "AUTH_CHECK_START": {
        const token = localStorage.getItem("jwt");
        
        if (!token) {
           void proposeAuthAction({ type: "SET_UNAUTHENTICATED" });
           return;
        }

        const headers = { Authorization: `Bearer ${token}` };

        const { data, error } = await api.api.auth.me.get({
            headers
        });

        if (!error && data) {
          const authData = data as unknown as AuthMeResponse;
          
          void proposeAuthAction({ 
              type: "SET_AUTHENTICATED", 
              payload: {
                  user: authData.user,
                  tenant: authData.tenant,
                  role: authData.role
              } 
          });
        } else if (error) {
           void proposeAuthAction({ type: "SET_UNAUTHENTICATED" });
        }
        break;
      }

      case "LOGOUT_START": {
        localStorage.removeItem("jwt");
        void proposeAuthAction({ type: "LOGOUT_SUCCESS" });
        break;
      }

      case "LOGOUT_SUCCESS": {
        await runClientPromise(navigate("/login"));
        break;
      }
    }
  } catch (err) {
     
    console.error("[authStore] Action failed:", err);
    
    // Offline Fallback
    if (action.type === "AUTH_CHECK_START") {
      const token = localStorage.getItem("jwt");
      if (token) {
        try {
            const payloadPart = token.split('.')[1];
            if (!payloadPart) throw new Error("Invalid JWT format");
            
            const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
            const payloadStr = atob(base64);
            const rawUser = JSON.parse(payloadStr) as RawUserPayload;
            
            // ✅ FIX: Removed tenant_strategy, database_name, subdomain assignment
            const user: PublicUser = {
                id: rawUser.id as PublicUser["id"],
                email: rawUser.email,
                avatar_url: rawUser.avatar_url ?? null,
                permissions: rawUser.permissions || [],
                email_verified: rawUser.email_verified ?? true,
                created_at: rawUser.created_at ? new Date(rawUser.created_at) : new Date(),
            };
            
            console.warn("[authStore] Offline detected. Using optimistic auth from token.");
            void proposeAuthAction({ 
                type: "SET_AUTHENTICATED", 
                payload: { user, tenant: null, role: null } 
            });
            return; 
        } catch (e) {
            console.error("[authStore] Failed to decode token for offline auth:", e);
        }
      }
      
      void proposeAuthAction({ type: "SET_UNAUTHENTICATED" });
    }
  }
};

export const initializeAuthStore = () => {};
