import { Elysia } from "elysia";
import { Effect, Either } from "effect";
import { userContext } from "../context";
import { effectPlugin } from "../middleware/effect-plugin";
import { uploadAvatar } from "../../lib/server/s3";
// REMOVED: import { centralDb } from "../../db/client"; 
import {
    AvatarMissingError,
    AvatarUploadError,
    UnauthorizedError,
    UserDatabaseError,
} from "../../features/user/Errors";

const isFile = (val: unknown): val is File => {
    if (!val || typeof val !== "object") return false;
    const hasName = "name" in val;
    const hasSize = "size" in val;
    const hasType = "type" in val;
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
        async ({ request, user, userDb, set, runEffect }) => {
            const uploadEffect = Effect.gen(function* () {
                // Phase 3 Fix: userDb is provided by userContext and points to the tenant DB.
                if (!user || !userDb) {
                    return yield* Effect.fail(new UnauthorizedError());
                }

                let formData: FormData;
                try {
                    formData = yield* Effect.tryPromise({
                        try: () => request.formData(),
                        catch: (e) => new AvatarMissingError({ message: "Failed to parse form data structure", cause: e }),
                    });
                } catch {
                    return yield* Effect.fail(new AvatarMissingError({ message: "Failed to parse form data (unknown)" }));
                }

                const file = formData.get("avatar");

                if (!file) {
                    return yield* Effect.fail(new AvatarMissingError({ 
                        message: "Field 'avatar' missing." 
                    }));
                }

                if (!isFile(file)) {
                    return yield* Effect.fail(new AvatarMissingError({ 
                        message: "Field 'avatar' is not a valid file." 
                    }));
                }

                yield* Effect.logInfo(`[User] Uploading avatar to Tenant DB for ${user.id}`);

                const newUrl = yield* uploadAvatar(user.id, file).pipe(
                    Effect.mapError((cause) => new AvatarUploadError({ cause })),
                );

                // Phase 3: Update the local user table in the Tenant DB
                yield* Effect.tryPromise({
                    try: () =>
                        userDb
                            .updateTable("user")
                            .set({ avatar_url: newUrl })
                            .where("id", "=", user.id)
                            .execute(),
                    catch: (cause) => new UserDatabaseError({ cause }),
                });

                yield* Effect.logInfo(`[User] Avatar updated successfully for ${user.id} in tenant store.`);
                return { avatarUrl: newUrl };
            });

            const result = await runEffect(Effect.either(uploadEffect));
            return handleUserResult(result, set);
        }
    );
