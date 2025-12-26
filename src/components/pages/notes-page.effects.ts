// FILE: src/components/pages/notes-page.effects.ts
import { Effect } from "effect";
import { v4 as uuidv4 } from "uuid";
import { navigate } from "../../lib/client/router";
import { ReplicacheService } from "../../lib/client/replicache";
import { noteListState } from "../../lib/client/stores/noteListStore";
import { t } from "../../lib/client/stores/i18nStore";
import { clientLog } from "../../lib/client/clientLog";
import { generateUniqueTitle } from "../../lib/client/logic/title-utils";
import type { Action, NotesPageState } from "./notes-page.logic";
import { NoteCreationError, NoteDeletionError } from "../../lib/client/errors";
import type { NoteId, UserId } from "../../lib/shared/schemas";

export const handleNotesPageSideEffects = (
  action: Action,
  state: NotesPageState,
  dispatch: (action: Action) => void
) =>
  Effect.gen(function* () {
    switch (action.type) {
      case "CREATE_NOTE_START": {
        const replicache = yield* ReplicacheService;
        const userID = replicache.client.name;
        const newNoteId = uuidv4() as NoteId;
        const initialBlockId = uuidv4();

        const existingNotes = noteListState.peek();
        const existingTitles = new Set(existingNotes.map((n) => n.title));
        const baseTitle = t("common.untitled_note");
        const uniqueTitle = generateUniqueTitle(baseTitle, existingTitles);

        yield* Effect.tryPromise({
          try: () =>
            replicache.client.mutate.createNote({
              id: newNoteId,
              userID: userID as UserId,
              title: uniqueTitle,
              initialBlockId,
            }),
          catch: (cause) => new NoteCreationError({ cause }),
        });

        yield* navigate(`/notes/${newNoteId}`).pipe(
          Effect.mapError((cause) => new NoteCreationError({ cause })),
        );
        
        break;
      }

      case "CONFIRM_DELETE_NOTE": {
        if (
          state.status === "ready" &&
          state.interaction.type === "deleting"
        ) {
          const noteId = state.interaction.noteId;
          const replicache = yield* ReplicacheService;
          
          yield* Effect.tryPromise({
            try: () => replicache.client.mutate.deleteNote({ id: noteId }),
            catch: (cause) => new NoteDeletionError({ cause }),
          });

          yield* Effect.sync(() =>
            dispatch({ type: "DELETE_NOTE_COMPLETE" }),
          );
        }
        break;
      }

      case "CONFIRM_BULK_DELETE": {
        if (
          state.status === "ready" && 
          state.interaction.type === "bulk_deleting"
        ) {
          const idsToDelete = Array.from(state.selectedNoteIds);
          const replicache = yield* ReplicacheService;

          yield* clientLog("info", `[notes-page] Bulk deleting ${idsToDelete.length} notes...`);

          yield* Effect.all(
              idsToDelete.map(id => 
                  Effect.tryPromise({
                      try: () => replicache.client.mutate.deleteNote({ id }),
                      catch: (cause) => new NoteDeletionError({ cause })
                  })
              ),
              { concurrency: "unbounded" }
          );

          yield* Effect.sync(() => 
              dispatch({ type: "BULK_DELETE_COMPLETE" })
          );
        }
        break;
      }
    }
  });
