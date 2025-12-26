// File: src/components/pages/note-page.logic.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { update, type NotePageState } from "./note-page.logic";
import type { AppNote } from "../../lib/shared/schemas";
import { NoteTaskUpdateError } from "../../lib/client/errors";

// --- Mocks ---
vi.mock("../editor/tiptap-editor", () => ({
  convertTiptapToMarkdown: vi.fn(
    (doc) => `# Mock Markdown for ${JSON.stringify(doc)}`
  ),
  convertMarkdownToTiptap: vi.fn((text) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: `Mock Doc for ${text}` }],
      },
    ],
  })),
}));

// --- Test Data ---
const mockNote: AppNote = {
  id: "note-1" as any,
  user_id: "user-1" as any,
  title: "Test Note",
  content: { type: "doc", content: [] },
  version: 1,
  global_version: "100", // Added to match schema
  created_at: new Date(),
  updated_at: new Date(),
};

const readyState: NotePageState = {
  status: "ready",
  note: mockNote,
  blocks: [], // ✅ FIX: Added blocks array
  isSaving: false,
  saveError: null,
  allNoteTitles: new Set(),
  preview: null,
  deleteConfirmOpen: false, 
};

describe("note-page.logic update() FSM", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Transitions from Any State", () => {
    it("INITIALIZE_START resets state to loading", () => {
      const stateWithData: NotePageState = {
        status: "error",
        error: new NoteTaskUpdateError({ cause: "foo" }),
      };

      const newState = update(stateWithData, { type: "INITIALIZE_START" });

      expect(newState).toEqual({ status: "loading" });
    });
  });

  describe("Ready State Logic", () => {
    it("DATA_UPDATED updates data and stays ready", () => {
      const newState = update(readyState, {
        type: "DATA_UPDATED",
        payload: {
          note: { ...mockNote, title: "New Title", version: 2 },
          allNotes: [],
          blocks: [] // ✅ Added blocks payload
        }
      });

      if (newState.status !== "ready") throw new Error("Should be ready");
      expect(newState.note.title).toBe("New Title");
    });

    it("DATA_UPDATED ignores same version if isSaving is true (Fix for revert bug)", () => {
      const dirtyState: NotePageState = {
        ...readyState,
        isSaving: true,
        note: { ...mockNote, title: "My Local Edit" } // version is still 1
      };

      // Server sends version 1 (e.g. initial load or confirmation)
      const newState = update(dirtyState, {
        type: "DATA_UPDATED",
        payload: {
          note: { ...mockNote, title: "Old Server Title", version: 1 },
          allNotes: [],
          blocks: [] // ✅ Added blocks payload
        }
      });

      if (newState.status !== "ready") throw new Error("Should be ready");
      // Should preserve local edit
      expect(newState.note.title).toBe("My Local Edit");
    });

    it("DATA_UPDATED accepts newer version even if isSaving is true", () => {
      const dirtyState: NotePageState = {
        ...readyState,
        isSaving: true,
        note: { ...mockNote, title: "My Local Edit" } // version 1
      };

      // Server sends version 2 (e.g. Replicache rebase finished)
      const newState = update(dirtyState, {
        type: "DATA_UPDATED",
        payload: {
          note: { ...mockNote, title: "My Local Edit", version: 2 },
          allNotes: [],
          blocks: [] // ✅ Added blocks payload
        }
      });

      if (newState.status !== "ready") throw new Error("Should be ready");
      // Should accept update (which likely matches local title now)
      expect(newState.note.version).toBe(2);
    });

    it("UPDATE_FIELD sets isSaving to true", () => {
      const newState = update(readyState, {
        type: "UPDATE_FIELD",
        payload: { title: "Typing..." }
      });

      if (newState.status !== "ready") throw new Error("Should be ready");
      expect(newState.isSaving).toBe(true);
      expect(newState.note.title).toBe("Typing...");
    });
  });

  describe("Impossible Transitions (Business Checks)", () => {
    it("UPDATE_FIELD does nothing if state is Loading", () => {
      const loadingState: NotePageState = { status: "loading" };
      const newState = update(loadingState, { 
        type: "UPDATE_FIELD", 
        payload: { title: "Should not happen" } 
      });
      expect(newState).toBe(loadingState); // Identity equality check
    });
  });

  describe("Preview Logic", () => {
    it("PREVIEW_HOVER_START initializes preview state with loading", () => {
      const newState = update(readyState, {
        type: "PREVIEW_HOVER_START",
        payload: { title: "Target Note", x: 100, y: 200 }
      });

      if (newState.status !== "ready") throw new Error("Should be ready");
      
      expect(newState.preview).toEqual({
        visible: true,
        title: "Target Note",
        x: 100,
        y: 200,
        snippet: null // Loading state
      });
    });

    it("PREVIEW_DATA_LOADED updates snippet", () => {
      const loadingPreviewState: NotePageState = {
        ...readyState,
        preview: {
          visible: true,
          title: "Target Note",
          x: 100,
          y: 200,
          snippet: null
        }
      };

      const newState = update(loadingPreviewState, {
        type: "PREVIEW_DATA_LOADED",
        payload: { snippet: "Loaded content..." }
      });

      if (newState.status !== "ready") throw new Error("Should be ready");
      expect(newState.preview?.snippet).toBe("Loaded content...");
    });

    it("PREVIEW_HOVER_END clears preview", () => {
      const visibleState: NotePageState = {
        ...readyState,
        preview: {
          visible: true,
          title: "Target Note",
          x: 100,
          y: 200,
          snippet: "Content"
        }
      };

      const newState = update(visibleState, { type: "PREVIEW_HOVER_END" });

      if (newState.status !== "ready") throw new Error("Should be ready");
      expect(newState.preview).toBeNull();
    });
  });
});
