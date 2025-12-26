// FILE: src/lib/shared/content-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseContentToBlocks } from "./content-parser";
import type { TiptapDoc, NoteId, UserId } from "./schemas";

const NOTE_ID = "note-1" as NoteId;
const USER_ID = "user-1" as UserId;

describe("Content Parser (Metadata Extraction)", () => {
  it("extracts simple key::value metadata from text", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Task item " },
            // Simulating a Tiptap Mark (Client side behavior)
            { 
              type: "text", 
              text: "status::active",
              marks: [{ type: "metadataMark", attrs: { key: "status", value: "active" } }]
            }
          ]
        }
      ]
    };

    const blocks = parseContentToBlocks(NOTE_ID, USER_ID, doc);
    
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.fields).toEqual({ status: "active" });
  });

  it("extracts metadata from raw text using Regex fallback (Server side safety)", () => {
    // This simulates pasted text that hasn't been hydrated into Marks yet
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "due::2025-01-01 and priority::high" }
          ]
        }
      ]
    };

    const blocks = parseContentToBlocks(NOTE_ID, USER_ID, doc);
    
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.fields).toEqual({
      due: "2025-01-01",
      priority: "high"
    });
  });

  it("handles metadata with WikiLinks as values", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "assigned::[[John Doe]]" }
          ]
        }
      ]
    };

    const blocks = parseContentToBlocks(NOTE_ID, USER_ID, doc);
    
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.fields).toEqual({
      assigned: "[[John Doe]]"
    });
  });

  it("merges metadata with existing task fields", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "- [x] Finish report due::today" }
          ]
        }
      ]
    };

    const blocks = parseContentToBlocks(NOTE_ID, USER_ID, doc);
    
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("task");
    expect(blocks[0]?.fields).toMatchObject({
      is_complete: true,
      due: "today"
    });
  });
});
