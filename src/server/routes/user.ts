// FILE: src/server/routes/user.ts
import { Elysia } from "elysia";
import { Effect, Either } from "effect";
import { userContext } from "../context";
import { effectPlugin } from "../middleware/effect-plugin";
import { uploadAvatar } from "../../lib/server/s3";
import { centralDb } from "../../db/client";
import {
  AvatarMissingError,
  AvatarUploadError,
  UnauthorizedError,
  UserDatabaseError,
} from "../../features/user/Errors";

// Helper to safely check if an object acts like a File (Duck Typing)
// This is more robust than instanceof in some Bun/Edge contexts.
const isFile = (val: unknown): val is File => {
  if (!val || typeof val !== "object") return false;
  // Check for essential File/Blob properties
  const hasName = "name" in val;
  const hasSize = "size" in val;
  const hasType = "type" in val;
  // Bun's File/Blob implementation definitely has stream()
  // FIX: Cast to an interface with stream to avoid 'any' and unsafe access errors
  const hasStream = "stream" in val && typeof (val as { stream: unknown }).stream === "function";

  return (val instanceof File) || (hasName && hasSize && hasType && hasStream);
};

const handleUserResult = <A>(
  result: Either.Either<A, unknown>,
  set: { status?: number | string },
) => {
  if (Either.isRight(result)) {
    return result.right;
  }

  const error = result.left;

  if (error instanceof UnauthorizedError) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  if (error instanceof AvatarMissingError) {
    set.status = 400;
    // Return the specific debug message if available
    return { error: error.message || "Avatar file missing or invalid" };
  }
  if (error instanceof AvatarUploadError) {
    console.error("[User] Avatar upload failed:", error.cause);
    set.status = 502;
    return { error: "Failed to upload avatar" };
  }
  if (error instanceof UserDatabaseError) {
    console.error("[User] DB Update failed:", error.cause);
    set.status = 500;
    return { error: "Internal Server Error" };
  }

  console.error("[User] Unexpected error:", error);
  set.status = 500;
  return { error: "Internal Server Error" };
};

export const userRoutes = new Elysia({ prefix: "/api/user" })
  .use(userContext)
  .use(effectPlugin)
  .post(
    "/avatar",
    async ({ request, user, set, runEffect }) => {
      const uploadEffect = Effect.gen(function* () {
        if (!user) {
          return yield* Effect.fail(new UnauthorizedError());
        }

        // 1. Parse FormData
        let formData: FormData;
        try {
          formData = yield* Effect.tryPromise({
            try: () => request.formData(),
            catch: (e) => {
              console.error("[User] request.formData() threw:", e);
              return new AvatarMissingError({ message: "Failed to parse form data structure", cause: e });
            },
          });
        } catch  { // FIX: Rename unused variable to _e
          return yield* Effect.fail(new AvatarMissingError({ message: "Failed to parse form data (unknown)" }));
        }

        const file = formData.get("avatar");

        // 2. Validate Existence
        if (!file) {
          const keys = Array.from(formData.keys());
          console.warn("[User] 'avatar' field missing. Received keys:", keys);
          return yield* Effect.fail(new AvatarMissingError({ 
            message: `Field 'avatar' missing. Received fields: ${keys.join(", ")}` 
          }));
        }

        // 3. Validate Type
        if (!isFile(file)) {
          const type = typeof file;
          const isObj = type === "object" && file !== null;
          const details = isObj ? JSON.stringify(file) : String(file);
          console.warn(`[User] Invalid file object. Type: ${type}, Value:`, file);
          
          return yield* Effect.fail(new AvatarMissingError({ 
            message: `Field 'avatar' is not a File. Received type: ${type}. Value summary: ${details.slice(0, 100)}` 
          }));
        }

        console.info(
          `[User] Uploading avatar for ${user.id} (${file.size} bytes, type: ${file.type})`
        );

        // 4. Upload
        const newUrl = yield* uploadAvatar(user.id, file).pipe(
          Effect.mapError((cause) => new AvatarUploadError({ cause })),
        );

        // 5. Update DB
        yield* Effect.tryPromise({
          try: () =>
            centralDb
              .updateTable("user")
              .set({ avatar_url: newUrl })
              .where("id", "=", user.id)
              .execute(),
          catch: (cause) => new UserDatabaseError({ cause }),
        });

        return { avatarUrl: newUrl };
      });

      const result = await runEffect(Effect.either(uploadEffect));
      return handleUserResult(result, set);
    },
    // We remove strict schema validation for body here to rely on manual parsing
    {}
  );
