// FILE: src/components/editor/extensions/InteractiveNode.wtr.test.ts
import { html, fixture, expect } from "@open-wc/testing";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { InteractiveNode } from "./InteractiveNode";
import type { EditorView } from "@tiptap/pm/view";
import type { Transaction } from "@tiptap/pm/state";

// Note: We use a regular function here to access 'this.timeout'
describe("Tiptap Input Rules (Browser)", function () {
  // Increase timeout to 30s to allow for Tiptap + Effect runtime initialization
  this.timeout(30000);

  let editorElement: HTMLElement;
  let editor: Editor | undefined;

  beforeEach(async () => {
    editorElement = await fixture(html`<div class="editor-host"></div>`);
    
    // Use minimal extensions to isolate InteractiveNode behavior
    editor = new Editor({
      element: editorElement,
      extensions: [
        Document,
        Paragraph,
        Text,
        InteractiveNode
      ],
      content: "<p></p>", // Start empty
    });
  });

  afterEach(() => {
    // Check if editor exists before destroying to avoid errors masking the real failure
    if (editor) {
        editor.destroy();
        editor = undefined;
    }
  });

  it("converts '[] ' into an interactive task block", async () => {
    if (!editor) throw new Error("Editor failed to initialize");

    // 1. Insert the text prefix *before* the trigger character (space)
    editor.chain().focus().insertContent("[]").run();

    // 2. Simulate typing the trigger character (space) using ProseMirror's handleTextInput prop.
    const { view } = editor;
    
    // ✅ FIX: Allow return type to be boolean | void to match ProseMirror's flexible signature types
    const handled = view.someProp("handleTextInput", (f: (view: EditorView, from: number, to: number, text: string, deflt: () => Transaction) => boolean | void) => 
        !!f(view, view.state.selection.from, view.state.selection.to, " ", () => null as unknown as Transaction)
    );

    expect(handled).to.be.true;

    // 3. Verify the transformation
    const json = editor.getJSON();
    const firstNode = json.content?.[0];

    expect(firstNode).to.exist;
    expect(firstNode?.type).to.equal("interactiveBlock");
    expect(firstNode?.attrs?.blockType).to.equal("task");
    expect(firstNode?.attrs?.fields?.is_complete).to.be.false;
  });

  it("converts '[x] ' into a completed interactive task block", async () => {
    if (!editor) throw new Error("Editor failed to initialize");

    // 1. Insert text prefix
    editor.chain().focus().insertContent("[x]").run();

    // 2. Simulate typing space
    const { view } = editor;
    
    // ✅ FIX: Allow return type to be boolean | void
    const handled = view.someProp("handleTextInput", (f: (view: EditorView, from: number, to: number, text: string, deflt: () => Transaction) => boolean | void) => 
        !!f(view, view.state.selection.from, view.state.selection.to, " ", () => null as unknown as Transaction)
    );

    expect(handled).to.be.true;

    // 3. Verify transformation
    const json = editor.getJSON();
    const firstNode = json.content?.[0];

    expect(firstNode).to.exist;
    expect(firstNode?.type).to.equal("interactiveBlock");
    expect(firstNode?.attrs?.blockType).to.equal("task");
    expect(firstNode?.attrs?.fields?.is_complete).to.be.true;
  });
});
