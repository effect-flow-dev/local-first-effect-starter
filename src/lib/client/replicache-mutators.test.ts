// FILE: src/lib/client/replicache-mutators.test.ts
import { describe, it, expect, vi } from "vitest";
import { mutators } from "./replicache";
import type { NoteId, UserId, BlockId } from "../shared/schemas";

// Mock Transaction
const createMockTx = (data: Record<string, unknown> = {}) => ({
  get: vi.fn(async (key: string) => data[key]),
  set: vi.fn(async (key: string, value: unknown) => { data[key] = value }),
  del: vi.fn(async (key: string) => { delete data[key] }),
  scan: vi.fn(() => ({
    values: () => ({
      toArray: async () => Object.entries(data)
        .filter(([k]) => k.startsWith("note/"))
        .map(([, v]) => v)
    })
  })),
} as any);

describe("Replicache Mutators (Client-Side)", () => {
  const userId = "u1" as UserId;
  const noteId = "n1" as NoteId;

  it("updateNote: should do nothing if note does not exist", async () => {
    const tx = createMockTx({}); // Empty DB
    await mutators.updateNote(tx, {
      id: noteId,
      title: "New Title",
      content: { type: "doc", content: [] }
    });

    expect(tx.set).not.toHaveBeenCalled();
  });

  it("updateTask: should do nothing if note list is empty", async () => {
    const tx = createMockTx({});
    await mutators.updateTask(tx, {
      blockId: "b1" as BlockId,
      isComplete: true,
      version: 1, // ✅ Added
    });

    expect(tx.set).not.toHaveBeenCalled();
  });

  it("updateTask: should do nothing if block ID is not found in any note", async () => {
    const existingNote = {
      id: noteId,
      user_id: userId,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hello" }] }
        ]
      }
    };
    
    const tx = createMockTx({
      [`note/${noteId}`]: existingNote
    });

    await mutators.updateTask(tx, {
      blockId: "missing-block" as BlockId,
      isComplete: true,
      version: 1, // ✅ Added
    });

    expect(tx.set).not.toHaveBeenCalled();
  });

  it("updateTask: should update correct note when block is found", async () => {
    const blockId = "b1" as BlockId;
    const existingNote = {
      id: noteId,
      user_id: userId,
      version: 1,
      content: {
        type: "doc",
        content: [
          { 
            type: "interactiveBlock", 
            attrs: { blockId, blockType: "task", fields: { is_complete: false }, version: 1 },
            content: []
          }
        ]
      }
    };

    const tx = createMockTx({
      [`note/${noteId}`]: existingNote
    });

    await mutators.updateTask(tx, {
      blockId,
      isComplete: true,
      version: 1, // ✅ Added
    });

    expect(tx.set).toHaveBeenCalledTimes(1);
    const [key, value] = tx.set.mock.calls[0];
    
    expect(key).toBe(`note/${noteId}`);
    expect((value as any).version).toBe(2);
    const blockNode = (value as any).content.content[0];
    expect(blockNode.attrs.fields.is_complete).toBe(true);
    // Optimistic client update sets version to sent version + 1
    expect(blockNode.attrs.version).toBe(2);
  });

  it("updateBlock: should merge fields and update the note", async () => {
    const blockId = "b2" as BlockId;
    const existingNote = {
      id: noteId,
      user_id: userId,
      version: 1,
      content: {
        type: "doc",
        content: [
          { 
            type: "interactiveBlock", 
            attrs: { 
              blockId, 
              blockType: "image", 
              fields: { url: "http://old.com", uploadId: "123" },
              version: 1
            },
            content: []
          }
        ]
      }
    };

    const tx = createMockTx({
      [`note/${noteId}`]: existingNote
    });

    await mutators.updateBlock(tx, {
      blockId,
      fields: { url: "http://new.com", uploadId: null },
      version: 1, // ✅ Added
    });

    expect(tx.set).toHaveBeenCalledTimes(1);
    const [key, value] = tx.set.mock.calls[0];
    
    expect(key).toBe(`note/${noteId}`);
    expect((value as any).version).toBe(2);
    
    const blockNode = (value as any).content.content[0];
    expect(blockNode.attrs.fields.url).toBe("http://new.com");
    expect(blockNode.attrs.fields.uploadId).toBeNull();
    expect(blockNode.attrs.version).toBe(2);
  });
});
