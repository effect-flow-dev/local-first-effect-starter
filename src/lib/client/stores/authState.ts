// FILE: src/lib/client/stores/authState.ts
import { signal } from "@preact/signals-core";
import type { PublicUser } from "../../shared/schemas";

export interface AuthModel {
  readonly status:
    | "initializing"
    | "unauthenticated"
    | "authenticating"
    | "authenticated";
  readonly user: PublicUser | null;
}

export const authState = signal<AuthModel>({
  status: "initializing",
  user: null,
});
