// FILE: src/components/pages/notes-page.test.ts
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { NotesPage } from "./notes-page";
import { noteListState } from "../../lib/client/stores/noteListStore";
import { NoteDeletionError } from "../../lib/client/errors";
import type { AppNoteMetadata, NoteId, UserId } from "../../lib/shared/schemas";

// --- Mocks & Constants ---
const MOCK_NOTE_ID = "00000000-0000-0000-0000-000000000001" as NoteId;
const MOCK_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as UserId;

const MOCK_NOTE: AppNoteMetadata = {
  id: MOCK_NOTE_ID,
  user_id: MOCK_USER_ID,
  title: "Test Note",
  updated_at: new Date(),
} as any;

const { mockDeleteNote, mockEffect } = vi.hoisted(() => ({
  mockDeleteNote: vi.fn(() => Promise.resolve()),
  mockEffect: vi.fn(),
}));

vi.mock("@preact/signals-core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@preact/signals-core")>();
  return {
    ...original,
    effect: mockEffect,
  };
});

// --- Runtime Mock ---
vi.mock("../../lib/client/runtime", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../lib/client/runtime")>();
    const { Runtime, Effect, Layer } = await import("effect");
    
    const { ReplicacheService } = await vi.importActual<typeof import("../../lib/client/replicache")>("../../lib/client/replicache");
    const { LocationService } = await vi.importActual<typeof import("../../lib/client/LocationService")>("../../lib/client/LocationService");
    
    const LocationServiceTestLive = Layer.succeed(LocationService, LocationService.of({ navigate: () => Effect.void, pathname: Effect.void } as any));
    const ReplicacheServiceTestLive = Layer.succeed(ReplicacheService, ReplicacheService.of({
      client: { mutate: { deleteNote: mockDeleteNote } },
    } as any));

    const TestLayers = Layer.mergeAll(
        LocationServiceTestLive,
        ReplicacheServiceTestLive
    );

    const testRuntime = Effect.runSync(
        Layer.toRuntime(TestLayers).pipe(Effect.scoped)
    );
    
    return {
        ...original,
        runClientUnscoped: (effect: any) => Runtime.runFork(testRuntime)(effect),
    };
});

describe("NotesPage Component (Delete Flow)", () => {
  let notesPage: NotesPage;

  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    noteListState.value = [MOCK_NOTE];
    
    mockEffect.mockImplementation((fn) => {
      fn(); 
      return vi.fn(); 
    });

    if (!customElements.get("notes-page")) {
        customElements.define("notes-page", NotesPage);
    }
    notesPage = new NotesPage();
    document.body.appendChild(notesPage);
  });

  afterEach(() => {
    if (notesPage && notesPage.parentNode) {
      document.body.removeChild(notesPage);
    }
  });
  
  it("state: REQUEST_DELETE_NOTE sets the interaction to confirming_delete", async () => {
    notesPage.dispatch({ type: "REQUEST_DELETE_NOTE", payload: MOCK_NOTE_ID });
    await notesPage.updateComplete;
    
    const state = notesPage.state.value;
    if (state.status !== "ready") throw new Error("State should be ready");
    
    expect(state.interaction).toEqual({ type: "confirming_delete", noteId: MOCK_NOTE_ID });
    expect(state.error).toBeNull();
  });

  it("state: CANCEL_DELETE_NOTE resets interaction to idle", async () => {
    notesPage.dispatch({ type: "REQUEST_DELETE_NOTE", payload: MOCK_NOTE_ID });
    await notesPage.updateComplete;
    
    notesPage.dispatch({ type: "CANCEL_DELETE_NOTE" });
    await notesPage.updateComplete;
    
    const state = notesPage.state.value;
    if (state.status !== "ready") throw new Error("State should be ready");
    
    expect(state.interaction).toEqual({ type: "idle" });
  });

  it("flow: CONFIRM_DELETE_NOTE executes deletion", async () => {
    notesPage.dispatch({ type: "REQUEST_DELETE_NOTE", payload: MOCK_NOTE_ID });
    await notesPage.updateComplete;
    
    // Simulate user confirming
    notesPage.dispatch({ type: "CONFIRM_DELETE_NOTE" });
    
    // The state should now be 'deleting'
    let state = notesPage.state.value;
    if (state.status !== "ready") throw new Error("State should be ready");
    expect(state.interaction).toEqual({ type: "deleting", noteId: MOCK_NOTE_ID });

    // Wait for async effect (mockDeleteNote)
    await vi.waitUntil(() => mockDeleteNote.mock.calls.length > 0);
    expect(mockDeleteNote).toHaveBeenCalledWith({ id: MOCK_NOTE_ID });
    
    // Wait for the completion dispatch
    await vi.waitUntil(() => {
        const s = notesPage.state.value;
        return s.status === "ready" && s.interaction.type === "idle";
    });
  });
  
  it("flow: Deletion failure should dispatch DELETE_NOTE_ERROR", async () => {
    notesPage.dispatch({ type: "REQUEST_DELETE_NOTE", payload: MOCK_NOTE_ID });
    await notesPage.updateComplete;

    mockDeleteNote.mockImplementationOnce(() => Promise.reject(new Error("DB failed")));
    
    notesPage.dispatch({ type: "CONFIRM_DELETE_NOTE" });

    // Wait for error state
    await vi.waitUntil(() => {
        const s = notesPage.state.value;
        return s.status === "ready" && s.error instanceof NoteDeletionError;
    });

    const state = notesPage.state.value;
    if (state.status !== "ready") throw new Error("State should be ready");
    
    expect(state.interaction).toEqual({ type: "idle" }); // Error resets interaction to idle usually
    expect(state.error).toBeInstanceOf(NoteDeletionError);
  });
});
