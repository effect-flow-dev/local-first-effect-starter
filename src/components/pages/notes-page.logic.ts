// FILE: src/components/pages/notes-page.logic.ts
import type { AppNoteMetadata, NoteId } from "../../lib/shared/schemas";
import { NoteCreationError, NoteDeletionError } from "../../lib/client/errors";

// --- State Definitions ---

export type NotesInteraction =
  | { type: "idle" }
  | { type: "creating" }
  | { type: "confirming_delete"; noteId: NoteId }
  | { type: "deleting"; noteId: NoteId }
  // ✅ NEW: Bulk interactions
  | { type: "confirming_bulk_delete" }
  | { type: "bulk_deleting" };

export interface LoadingState {
  readonly status: "loading";
}

export interface ReadyState {
  readonly status: "ready";
  readonly notes: AppNoteMetadata[];
  readonly interaction: NotesInteraction;
  readonly error: NoteCreationError | NoteDeletionError | null;
  // ✅ NEW: Selection state
  readonly selectedNoteIds: Set<NoteId>;
}

export type NotesPageState = LoadingState | ReadyState;

export const INITIAL_STATE: NotesPageState = { status: "loading" };

// --- Actions ---

export type Action =
  | { type: "NOTES_UPDATED"; payload: AppNoteMetadata[] }
  | { type: "CREATE_NOTE_START" }
  | { type: "CREATE_NOTE_COMPLETE" }
  | { type: "CREATE_NOTE_ERROR"; payload: NoteCreationError }
  | { type: "REQUEST_DELETE_NOTE"; payload: NoteId }
  | { type: "CANCEL_DELETE_NOTE" }
  | { type: "CONFIRM_DELETE_NOTE" }
  | { type: "DELETE_NOTE_COMPLETE" }
  | { type: "DELETE_NOTE_ERROR"; payload: NoteDeletionError }
  | { type: "CLEAR_ERROR" }
  // ✅ NEW: Bulk Actions
  | { type: "TOGGLE_SELECT_NOTE"; payload: NoteId }
  | { type: "TOGGLE_SELECT_ALL" }
  | { type: "CANCEL_SELECTION" }
  | { type: "REQUEST_BULK_DELETE" }
  | { type: "CANCEL_BULK_DELETE" }
  | { type: "CONFIRM_BULK_DELETE" }
  | { type: "BULK_DELETE_COMPLETE" };

// --- Reducer (Pure Update) ---

export const update = (
  state: NotesPageState,
  action: Action,
): NotesPageState => {
  switch (action.type) {
    case "NOTES_UPDATED":
      if (state.status === "loading") {
        return {
          status: "ready",
          notes: action.payload,
          interaction: { type: "idle" },
          error: null,
          selectedNoteIds: new Set(),
        };
      }
      // Preserve selection if possible, but filter out IDs that no longer exist
      const newIds = new Set(state.selectedNoteIds);
      const existingIds = new Set(action.payload.map(n => n.id));
      for (const id of newIds) {
        if (!existingIds.has(id)) newIds.delete(id);
      }
      return { ...state, notes: action.payload, selectedNoteIds: newIds };

    case "CREATE_NOTE_START":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "creating" },
        error: null,
      };

    case "CREATE_NOTE_COMPLETE":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "idle" },
      };

    case "CREATE_NOTE_ERROR":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "idle" },
        error: action.payload,
      };

    case "REQUEST_DELETE_NOTE":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "confirming_delete", noteId: action.payload },
        error: null,
      };

    case "CANCEL_DELETE_NOTE":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "idle" },
      };

    case "CONFIRM_DELETE_NOTE": {
      if (
        state.status !== "ready" ||
        state.interaction.type !== "confirming_delete"
      ) {
        return state;
      }
      return {
        ...state,
        interaction: { type: "deleting", noteId: state.interaction.noteId },
      };
    }

    case "DELETE_NOTE_COMPLETE":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "idle" },
      };

    case "DELETE_NOTE_ERROR":
      if (state.status !== "ready") return state;
      return {
        ...state,
        interaction: { type: "idle" },
        error: action.payload,
      };

    case "CLEAR_ERROR":
      if (state.status !== "ready") return state;
      return { ...state, error: null };

    // ✅ NEW: Bulk Action Handlers
    case "TOGGLE_SELECT_NOTE": {
      if (state.status !== "ready") return state;
      const newSet = new Set(state.selectedNoteIds);
      if (newSet.has(action.payload)) {
        newSet.delete(action.payload);
      } else {
        newSet.add(action.payload);
      }
      return { ...state, selectedNoteIds: newSet };
    }

    case "TOGGLE_SELECT_ALL": {
      if (state.status !== "ready") return state;
      // If all are selected, deselect all. Otherwise, select all.
      if (state.selectedNoteIds.size === state.notes.length && state.notes.length > 0) {
        return { ...state, selectedNoteIds: new Set() };
      }
      return {
        ...state,
        selectedNoteIds: new Set(state.notes.map((n) => n.id)),
      };
    }

    case "CANCEL_SELECTION":
      if (state.status !== "ready") return state;
      return { ...state, selectedNoteIds: new Set() };

    case "REQUEST_BULK_DELETE":
      if (state.status !== "ready") return state;
      if (state.selectedNoteIds.size === 0) return state;
      return {
        ...state,
        interaction: { type: "confirming_bulk_delete" },
      };

    case "CANCEL_BULK_DELETE":
      if (state.status !== "ready") return state;
      return { ...state, interaction: { type: "idle" } };

    case "CONFIRM_BULK_DELETE":
      if (state.status !== "ready") return state;
      return { ...state, interaction: { type: "bulk_deleting" } };

    case "BULK_DELETE_COMPLETE":
      if (state.status !== "ready") return state;
      return {
        ...state,
        selectedNoteIds: new Set(),
        interaction: { type: "idle" },
      };

    default:
      return state;
  }
};
