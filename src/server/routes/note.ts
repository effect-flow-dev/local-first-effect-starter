// FILE: src/server/routes/note.ts
import { Elysia, t } from "elysia";
import { Effect, Either } from "effect";
import { userContext } from "../context";
import { effectPlugin } from "../middleware/effect-plugin";
import { NoteDatabaseError, NoteNotFoundError } from "../../features/note/Errors";
import type { NoteId } from "../../lib/shared/schemas";
import { UnauthorizedError } from "../../features/user/Errors";

const handleNoteResult = <A>(
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
  if (error instanceof NoteNotFoundError) {
    set.status = 404;
    return { error: "Note not found" };
  }
  if (error instanceof NoteDatabaseError) {
    console.error("[Note] Database error:", error.cause);
    set.status = 500;
    return { error: "Internal Server Error" };
  }

  console.error("[Note] Unexpected error:", error);
  set.status = 500;
  return { error: "Internal Server Error" };
};

export const noteRoutes = new Elysia({ prefix: "/api/notes" })
  .use(userContext)
  .use(effectPlugin)
  .get(
    "/:id/history",
    async ({ params: { id }, user, userDb, set, runEffect }) => {
      const historyEffect = Effect.gen(function* () {
        if (!user || !userDb) {
          return yield* Effect.fail(new UnauthorizedError());
        }

        const noteId = id as NoteId;

        const note = yield* Effect.tryPromise({
          try: () =>
            userDb
              .selectFrom("note")
              .select("id")
              .where("id", "=", noteId)
              .executeTakeFirst(),
          catch: (cause) => new NoteDatabaseError({ cause }),
        });

        if (!note) {
          return yield* Effect.fail(new NoteNotFoundError());
        }

        const history = yield* Effect.tryPromise({
          try: () =>
            userDb
              .selectFrom("block_history")
              .selectAll()
              .where("note_id", "=", noteId)
              .orderBy("timestamp", "desc")
              .execute(),
          catch: (cause) => new NoteDatabaseError({ cause }),
        });

        const cleanedHistory = history.map((entry) => ({
          ...entry,
          change_delta: typeof entry.change_delta === "string" 
            ? JSON.parse(entry.change_delta) as unknown // ✅ FIX: Cast to unknown
            : entry.change_delta,
          content_snapshot: typeof entry.content_snapshot === "string" && entry.content_snapshot !== null
            ? JSON.parse(entry.content_snapshot) as unknown // ✅ FIX: Cast to unknown
            : entry.content_snapshot,
        }));

        return { history: cleanedHistory };
      });

      const result = await runEffect(Effect.either(historyEffect));
      return handleNoteResult(result, set);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
