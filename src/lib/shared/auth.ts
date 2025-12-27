// src/lib/shared/auth.ts
import { Context, Schema } from "effect";
import { RpcMiddleware } from "@effect/rpc";
import type { PublicUser } from "./schemas";

/**
 * Defines the contract for the authentication service.
 * This service provides the currently authenticated user.
 * 
 * Note: We use stateless JWTs, so there is no database 'Session' object.
 */
export class Auth extends Context.Tag("Auth")<
  Auth,
  { readonly user: PublicUser | null }
>() {}

/**
 * Defines the base error schema for all authentication and authorization failures.
 */
export class AuthError extends Schema.Class<AuthError>("AuthError")({
  _tag: Schema.Literal(
    "Unauthorized",
    "Forbidden",
    "BadRequest",
    "EmailAlreadyExistsError",
    "InternalServerError",
  ),
  message: Schema.String,
}) {}

/**
 * Defines the RPC Middleware Tag for authentication.
 */
export class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
  "AuthMiddleware",
  {
    wrap: false,
    provides: Auth,
    failure: AuthError,
  },
) {}
