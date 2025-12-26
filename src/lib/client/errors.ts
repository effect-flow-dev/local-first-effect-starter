// File: ./src/lib/client/errors.ts
import { Data } from "effect";

// --- Login/Auth Errors ---
export class LoginInvalidCredentialsError extends Data.TaggedError(
  "LoginInvalidCredentialsError",
) {}
export class LoginEmailNotVerifiedError extends Data.TaggedError(
  "LoginEmailNotVerifiedError",
) {}
export class EmailInUseError extends Data.TaggedError("EmailInUseError") {}
export class PasswordsDoNotMatchError extends Data.TaggedError(
  "PasswordsDoNotMatchError",
) {}
export class IncorrectPasswordError extends Data.TaggedError(
  "IncorrectPasswordError",
) {}
export class PasswordTooShortError extends Data.TaggedError(
  "PasswordTooShortError",
) {}
export class InvalidTokenError extends Data.TaggedError("InvalidTokenError") {}

// Generic fallback for auth
export class UnknownAuthError extends Data.TaggedError("UnknownAuthError")<{
  readonly cause: unknown;
}> {}

// --- Error Types ---
export class UnknownPasswordError extends Data.TaggedError(
  "UnknownPasswordError",
)<{
  readonly cause: unknown;
}> {}

export type LoginError =
  | LoginInvalidCredentialsError
  | LoginEmailNotVerifiedError
  | UnknownAuthError;

export type SignupError =
  | PasswordsDoNotMatchError
  | EmailInUseError
  | UnknownAuthError;

export type ForgotPasswordError = UnknownAuthError;

export type ResetPasswordError =
  | PasswordTooShortError
  | PasswordsDoNotMatchError
  | InvalidTokenError
  | UnknownAuthError;

export type VerifyEmailError = InvalidTokenError | UnknownAuthError;

// --- User Profile Errors ---
export class AvatarUploadError extends Data.TaggedError("AvatarUploadError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// --- Note Page (Single Note View) Errors ---
export class NoteNotFoundError extends Data.TaggedError("NoteNotFoundError") {}
export class NoteParseError extends Data.TaggedError("NoteParseError")<{
  readonly cause: unknown;
}> {}
export class NoteSaveError extends Data.TaggedError("NoteSaveError")<{
  readonly cause: unknown;
}> {}
export class NoteTaskUpdateError extends Data.TaggedError(
  "NoteTaskUpdateError",
)<{
  readonly cause: unknown;
}> {}

// --- Notes Page (List View) Errors ---
export class NoteCreationError extends Data.TaggedError("NoteCreationError")<{
  readonly cause: unknown;
}> {}
export class NoteDeletionError extends Data.TaggedError("NoteDeletionError")<{
  readonly cause: unknown;
}> {}

// --- Type Unions for Components ---
// ✅ FIX: Added NoteDeletionError to the union
export type NotePageError =
  | NoteNotFoundError
  | NoteParseError
  | NoteSaveError
  | NoteTaskUpdateError
  | NoteCreationError
  | NoteDeletionError;

export type NotesPageError = NoteCreationError | NoteDeletionError;
