// FILE: src/components/editor/extensions/InteractiveNode.lock.wtr.test.ts
import { html, fixture, expect } from "@open-wc/testing";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { InteractiveNode } from "./InteractiveNode";
import { presenceState } from "../../../lib/client/stores/presenceStore";
import { authState } from "../../../lib/client/stores/authStore";

describe("InteractiveNode (Soft Locking)", () => {
  const BLOCK_ID = "test-block-lock-1";
  const USER_A = "user-a"; // Me
  const USER_B = "user-b"; // Them

  let editor: Editor;
  let element: HTMLElement;
  let styleElement: HTMLStyleElement;

  beforeEach(async () => {
    // 1. Inject test-specific CSS to verify computed styles work
    // (In case global CSS is mocked by the test runner)
    styleElement = document.createElement("style");
    styleElement.innerHTML = `
      .is-remote-locked { 
        pointer-events: none !important; 
        opacity: 0.6;
      }
    `;
    document.head.appendChild(styleElement);

    // 2. Reset Stores
    authState.value = {
      status: "authenticated",
      user: { id: USER_A } as any,
      currentTenant: null,
      currentRole: null,
    };
    presenceState.value = {};

    // 3. Create Host
    element = await fixture(html`<div class="editor-host"></div>`);

    // 4. Init Editor
    editor = new Editor({
      element,
      extensions: [StarterKit, InteractiveNode],
      content: {
        type: "doc",
        content: [
          {
            type: "interactiveBlock",
            attrs: {
              blockId: BLOCK_ID,
              blockType: "task",
              fields: { status: "todo" },
            },
          },
        ],
      },
    });

    // Wait for editor to render
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  afterEach(() => {
    editor.destroy();
    styleElement.remove();
  });

  it("applies locking styles when a remote user (User B) is present", async () => {
    const blockEl = element.querySelector(
      `[data-block-id="${BLOCK_ID}"]`,
    ) as HTMLElement;
    expect(blockEl).to.exist;

    // Initial State: Not locked
    expect(blockEl.classList.contains("is-remote-locked")).to.be.false;

    // Action: User B enters the block
    presenceState.value = {
      [BLOCK_ID]: [
        { userId: USER_B, color: "#ff0000", lastActive: Date.now() },
      ],
    };

    // Wait for signal effect -> DOM update
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assertion 1: Class applied
    expect(blockEl.classList.contains("is-remote-locked")).to.be.true;

    // Assertion 2: Tooltip present
    expect(blockEl.getAttribute("title")).to.include(USER_B);

    // Assertion 3: Styles enforced
    const computed = window.getComputedStyle(blockEl);
    expect(computed.pointerEvents).to.equal("none");
    expect(computed.opacity).to.be.closeTo(0.6, 0.1);
  });

  it("removes locking styles when remote user leaves", async () => {
    const blockEl = element.querySelector(
      `[data-block-id="${BLOCK_ID}"]`,
    ) as HTMLElement;

    // Setup: Locked state
    presenceState.value = {
      [BLOCK_ID]: [
        { userId: USER_B, color: "#ff0000", lastActive: Date.now() },
      ],
    };
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(blockEl.classList.contains("is-remote-locked")).to.be.true;

    // Action: User B leaves
    presenceState.value = {};

    // Wait for update
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assertion: Unlocked
    expect(blockEl.classList.contains("is-remote-locked")).to.be.false;
    expect(blockEl.getAttribute("title")).to.be.null;
    
    const computed = window.getComputedStyle(blockEl);
    expect(computed.pointerEvents).to.not.equal("none");
  });

  it("does NOT lock if only the current user (User A) is present", async () => {
    const blockEl = element.querySelector(
      `[data-block-id="${BLOCK_ID}"]`,
    ) as HTMLElement;

    // Action: User A (Me) enters the block
    presenceState.value = {
      [BLOCK_ID]: [
        { userId: USER_A, color: "#00ff00", lastActive: Date.now() },
      ],
    };

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assertion: Should act as if empty (not locked)
    expect(blockEl.classList.contains("is-remote-locked")).to.be.false;
    const computed = window.getComputedStyle(blockEl);
    expect(computed.pointerEvents).to.not.equal("none");
  });

  it("locks correctly if BOTH users are present (Remote + Local)", async () => {
    const blockEl = element.querySelector(
      `[data-block-id="${BLOCK_ID}"]`,
    ) as HTMLElement;

    // Action: Both users present
    presenceState.value = {
      [BLOCK_ID]: [
        { userId: USER_A, color: "#00ff00", lastActive: Date.now() },
        { userId: USER_B, color: "#ff0000", lastActive: Date.now() },
      ],
    };

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assertion: Locked because User B is there
    expect(blockEl.classList.contains("is-remote-locked")).to.be.true;
    expect(blockEl.getAttribute("title")).to.include(USER_B);
    // Should NOT include self in the "Locked by" tooltip if filtered correctly
    expect(blockEl.getAttribute("title")).to.not.include(USER_A);
  });
});
