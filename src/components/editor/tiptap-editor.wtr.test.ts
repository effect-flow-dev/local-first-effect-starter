import { html, fixture, expect, waitUntil } from "@open-wc/testing";
import { TiptapEditor } from "./tiptap-editor";

// Register component
if (!customElements.get("tiptap-editor")) {
  customElements.define("tiptap-editor", TiptapEditor);
}

describe("Core: TiptapEditor", () => {
  it("initializes and renders the ProseMirror editor", async () => {
    const el = await fixture<TiptapEditor>(html`<tiptap-editor></tiptap-editor>`);

    // Tiptap creates a div with class .ProseMirror
    const editorDiv = el.querySelector(".ProseMirror");
    expect(editorDiv).to.exist;
    expect(editorDiv?.getAttribute("contenteditable")).to.equal("true");
  });

  it("renders initial JSON content", async () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello Web Test Runner" }]
        }
      ]
    };

    // Pass object as string or object depending on your component's prop handling.
    // Your component accepts `string | object` for `initialContent`.
    const el = await fixture<TiptapEditor>(html`
      <tiptap-editor .initialContent=${content}></tiptap-editor>
    `);

    const editorDiv = el.querySelector(".ProseMirror")!;
    expect(editorDiv.textContent).to.include("Hello Web Test Runner");
  });

  it("emits 'update' event when content changes", async () => {
    const el = await fixture<TiptapEditor>(html`<tiptap-editor></tiptap-editor>`);
    const editorDiv = el.querySelector(".ProseMirror") as HTMLElement;

    // Listen for the custom event
    let eventFired = false;
    el.addEventListener("update", () => {
      eventFired = true;
    });

    // Simulate typing: focus and execute command via the internal editor instance
    // Accessing private/internal property for testing purposes is common in complex wrappers
    // @ts-ignore
    const editor = el.editor; 
    
    if (editor) {
      editor.commands.insertContent("Updated Text");
    } else {
      // Fallback: raw DOM manipulation (less reliable for Tiptap but valid for integration)
      editorDiv.focus();
      document.execCommand('insertText', false, 'Updated Text');
    }

    // Wait for the debounced update or event loop
    await waitUntil(() => eventFired, "Update event should have fired");
    expect(editorDiv.textContent).to.include("Updated Text");
  });
});
