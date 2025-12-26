// File: src/components/pages/note-page.logic.ts
import { Effect, Schema } from "effect";
import { ReplicacheService } from "../../lib/client/replicache";
import {
  NoteSchema,
  type AppNote,
  type NoteId,
  type BlockId,
  type AppBlock, // ✅ Import AppBlock
} from "../../lib/shared/schemas";
import { authState } from "../../lib/client/stores/authStore";
import { v4 as uuidv4 } from "uuid";
import {
  NoteCreationError,
  NoteDeletionError,
  NoteTaskUpdateError,
  type NotePageError,
} from "../../lib/client/errors";
import { NoteTitleExistsError } from "../../lib/shared/errors";
import type { FullClientContext } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";
import { clientLog } from "../../lib/client/clientLog";

// ... State Definitions ...
export interface LoadingState {
  readonly status: "loading";
}

export interface ErrorState {
  readonly status: "error";
  readonly error: NotePageError | NoteTitleExistsError;
}

export interface PreviewState {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly snippet: string | null; 
}

export interface ReadyState {
  readonly status: "ready";
  readonly note: AppNote;
  readonly blocks: AppBlock[]; // ✅ Added blocks list
  readonly isSaving: boolean; 
  readonly saveError: NotePageError | NoteTitleExistsError | null; 
  readonly allNoteTitles: Set<string>;
  readonly preview: PreviewState | null;
  readonly deleteConfirmOpen: boolean;
}

export type NotePageState = LoadingState | ErrorState | ReadyState;

// --- Actions ---
export type Action =
  | { type: "INITIALIZE_START" }
  | { type: "INITIALIZE_ERROR"; payload: NotePageError }
  | {
      type: "DATA_UPDATED";
      payload: { note: AppNote; blocks: AppBlock[]; allNotes: AppNote[] }; // ✅ Added blocks
    }
  | {
      type: "UPDATE_FIELD";
      payload: Partial<Pick<AppNote, "title" | "content" | "notebook_id">>;
    }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_ERROR"; payload: NotePageError | NoteTitleExistsError }
  | {
      type: "UPDATE_TASK_START";
      payload: { blockId: BlockId; isComplete: boolean };
    }
  | { type: "UPDATE_TASK_ERROR"; payload: NoteTaskUpdateError }
  | { type: "NAVIGATE_TO_NOTE_BY_TITLE"; payload: { title: string } }
  | { type: "PREVIEW_HOVER_START"; payload: { title: string; x: number; y: number } }
  | { type: "PREVIEW_DATA_LOADED"; payload: { snippet: string } }
  | { type: "PREVIEW_HOVER_END" }
  | { type: "REQUEST_DELETE" }
  | { type: "CANCEL_DELETE" }
  | { type: "CONFIRM_DELETE" }
  | { type: "DELETE_ERROR"; payload: NoteDeletionError };

// --- Pure Update Function (Reducer) ---
export const update = (state: NotePageState, action: Action): NotePageState => {
  switch (action.type) {
    case "INITIALIZE_START":
      return { status: "loading" };

    case "INITIALIZE_ERROR":
      return { status: "error", error: action.payload };

    case "DATA_UPDATED": {
      const incomingNote = action.payload.note;
      const incomingBlocks = action.payload.blocks;
      const allNoteTitles = new Set(action.payload.allNotes.map((n) => n.title));
      
      const currentPreview = state.status === "ready" ? state.preview : null;
      const currentDeleteOpen = state.status === "ready" ? state.deleteConfirmOpen : false;

      // Optimistic update handling (prevent jitter)
      if (state.status === "ready") {
        if (state.isSaving && state.note.id === incomingNote.id && incomingNote.version <= state.note.version) {
           // We keep local note state, but we accept block updates as they are more granular
           // and often driven by specific block components
           return {
             ...state,
             blocks: incomingBlocks,
             allNoteTitles,
             preview: currentPreview
           };
        }
      }

      return {
        status: "ready",
        note: incomingNote,
        blocks: incomingBlocks, // ✅ Store blocks
        allNoteTitles,
        isSaving: false,
        saveError: null,
        preview: currentPreview,
        deleteConfirmOpen: currentDeleteOpen,
      };
    }

    case "UPDATE_FIELD": {
      if (state.status !== "ready") return state;
      return {
        ...state,
        note: { ...state.note, ...action.payload },
        isSaving: true,
        saveError: null,
      };
    }

    case "SAVE_START":
      if (state.status !== "ready") return state;
      return { ...state, isSaving: true, saveError: null };

    case "SAVE_SUCCESS":
      if (state.status !== "ready") return state;
      return { ...state, isSaving: false, saveError: null };

    case "SAVE_ERROR":
      if (state.status !== "ready") return state;
      return { ...state, isSaving: false, saveError: action.payload };

    // ... Pass-throughs ...
    case "UPDATE_TASK_START": return state;
    case "UPDATE_TASK_ERROR": return { status: "error", error: action.payload };
    case "NAVIGATE_TO_NOTE_BY_TITLE": return state;

    case "PREVIEW_HOVER_START": {
      if (state.status !== "ready") return state;
      return {
        ...state,
        preview: {
          visible: true,
          x: action.payload.x,
          y: action.payload.y,
          title: action.payload.title,
          snippet: null, 
        },
      };
    }

    case "PREVIEW_DATA_LOADED": {
      if (state.status !== "ready" || !state.preview) return state;
      return {
        ...state,
        preview: {
          ...state.preview,
          snippet: action.payload.snippet,
        },
      };
    }

    case "PREVIEW_HOVER_END": {
      if (state.status !== "ready") return state;
      return { ...state, preview: null };
    }

    case "REQUEST_DELETE":
      if (state.status !== "ready") return state;
      return { ...state, deleteConfirmOpen: true };

    case "CANCEL_DELETE":
      if (state.status !== "ready") return state;
      return { ...state, deleteConfirmOpen: false };

    case "CONFIRM_DELETE":
      return state; 

    case "DELETE_ERROR":
      if (state.status !== "ready") return state;
      return { ...state, deleteConfirmOpen: false, saveError: action.payload };

    default:
      return state;
  }
};

// ... Helpers & Side Effects ...
interface GenericNode {
  attrs?: {
    blockId?: string;
    version?: number;
    [key: string]: unknown;
  };
  content?: GenericNode[];
  [key: string]: unknown;
}

const findBlockVersion = (content: unknown, blockId: string): number => {
  if (typeof content !== "object" || content === null) return 1;
  const doc = content as { content?: GenericNode[] };
  if (!doc.content || !Array.isArray(doc.content)) return 1;

  const traverse = (nodes: GenericNode[]): number | null => {
    for (const node of nodes) {
      if (node.attrs?.blockId === blockId) {
        return node.attrs.version ?? 1;
      }
      if (node.content && Array.isArray(node.content)) {
        const found = traverse(node.content);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return traverse(doc.content) ?? 1;
};

export const handleAction = (
  action: Action,
  state: NotePageState,
): Effect.Effect<
  void,
  NotePageError,
  ReplicacheService | FullClientContext
> => {
  switch (action.type) {
    case "UPDATE_TASK_START": {
      return Effect.gen(function* () {
        const replicache = yield* ReplicacheService;
        let version = 1;
        if (state.status === "ready") {
            // Fallback version check if needed, though usually blocks carry their own version
            version = findBlockVersion(state.note.content, action.payload.blockId);
        }
        yield* Effect.tryPromise({
          try: () => replicache.client.mutate.updateTask({
             ...action.payload,
             version
          }),
          catch: (cause) => new NoteTaskUpdateError({ cause }),
        });
      });
    }
    case "NAVIGATE_TO_NOTE_BY_TITLE": {
      const { title } = action.payload;
      return Effect.gen(function* () {
        const replicache = yield* ReplicacheService;
        const noteJsons = yield* Effect.promise(() =>
          replicache.client.query((tx) =>
            tx.scan({ prefix: "note/" }).values().toArray(),
          ),
        );

        const notes: AppNote[] = noteJsons.flatMap((json) => {
          const result = Schema.decodeUnknownEither(NoteSchema)(json);
          if (result._tag === "Right") {
            return [result.right];
          }
          return [];
        });

        const targetNote = notes.find(
          (note) => note.title.toLowerCase() === title.toLowerCase(),
        );

        if (targetNote) {
          yield* navigate(`/notes/${targetNote.id}`);
        } else {
          const user = authState.value.user;
          if (!user) {
            return yield* Effect.die(
              new Error("User is not authenticated, cannot create note."),
            );
          }
          const newNoteId = uuidv4() as NoteId;
          
          yield* clientLog("info", "Creating new note from wiki-link", { title, newNoteId });
          
          yield* Effect.tryPromise({
            try: () =>
              replicache.client.mutate.createNote({
                id: newNoteId,
                userID: user.id,
                title,
              }),
            catch: (cause) => new NoteCreationError({ cause }),
          });
          yield* navigate(`/notes/${newNoteId}`);
        }
      }).pipe(Effect.mapError((cause) => new NoteCreationError({ cause })));
    }
    case "CONFIRM_DELETE": {
        return Effect.gen(function* () {
            if (state.status !== 'ready') return;
            const replicache = yield* ReplicacheService;
            
            yield* Effect.tryPromise({
                try: () => replicache.client.mutate.deleteNote({ id: state.note.id }),
                catch: (cause) => new NoteDeletionError({ cause })
            });

            yield* clientLog("info", `[note-page] Deleted note ${state.note.id}`);
            
            yield* navigate("/").pipe(
              Effect.mapError(e => new NoteDeletionError({ cause: e }))
            );
        });
    }
    default:
      return Effect.void;
  }
};
