// src/lib/shared/auth.ts
import { Context, Schema } from "effect";
import { RpcMiddleware } from "@effect/rpc";
import type { PublicUser } from "./schemas";
import type { Session } from "../../types/generated/public/Session";

/**
 * Defines the contract for the authentication service.
 * This service provides the currently authenticated user and their session, if any.
 * It will be available in the context of RPC handlers protected by the AuthMiddleware.
 */
export class Auth extends Context.Tag("Auth")<
  Auth,
  { readonly user: PublicUser | null; readonly session: Session | null }
>() {}

/**
 * Defines the base error schema for all authentication and authorization failures.
 * This is part of the public API contract for protected routes.
 * The `_tag` allows for discriminating between different kinds of auth errors.
 */
export class AuthError extends Schema.Class<AuthError>("AuthError")({
  _tag: Schema.Literal(
    "Unauthorized",
    "Forbidden",
    "BadRequest",
    "EmailAlreadyExistsError",
    "InternalServerError",
  ), //
  message: Schema.String,
}) {}

/**
 * Defines the RPC Middleware Tag for authentication.
 * This acts as an identifier for the authentication middleware.
 * It specifies that this middleware will:
 * - Not wrap the RPC handler (`wrap: false`).
 * - Provide the `Auth` service to the handler's context.
 * - Can fail with an `AuthError`.
 *
 * The actual implementation (the Layer) for this tag resides exclusively on the server.
 */
export class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
  "AuthMiddleware",
  {
    wrap: false,
    provides: Auth,
    failure: AuthError, //
  },
) {}
