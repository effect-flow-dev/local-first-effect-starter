import { html, fixture, expect, oneEvent } from "@open-wc/testing";

// 1. Import the CSS so the WTR config 'serve' hook can mock it (prevents 404s)
import "./styles/index.css";

// 2. Import YOUR actual component and dependencies
import "./components/editor/node-views/task-node-view";
// We import the class type for TypeScript casting
import type { TaskNodeView } from "./components/editor/node-views/task-node-view";

describe("Component: <task-node-view>", () => {
  it("renders the content and initial state correctly", async () => {
    const blockId = "test-block-1";
    const content = "Finish the project";
    const status = "done";
    
    // Render your actual component
    const el = await fixture<TaskNodeView>(html`
      <task-node-view 
        .blockId=${blockId} 
        .content=${content} 
        .status=${status}
      ></task-node-view>
    `);

    // createRenderRoot() returns 'this', so children are in Light DOM.
    // We look for the span that is a direct child of the .task-node-view container
    // to avoid selecting spans inside the dropdown menu (icons/labels).
    const textSpan = el.querySelector(".task-node-view > span");
    const dropdown = el.querySelector("dropdown-menu");

    expect(dropdown).to.exist;
    
    expect(textSpan).to.exist;
    expect(textSpan!.textContent).to.equal(content);
    
    // Verify your dynamic class logic (line-through and gray color when done)
    expect(textSpan!.classList.contains("line-through")).to.be.true;
    expect(textSpan!.classList.contains("text-zinc-400")).to.be.true;
  });

  it("dispatches 'update-block-field' event when status is changed", async () => {
    const el = await fixture<TaskNodeView>(html`
      <task-node-view 
        .blockId=${"block-123"} 
        .content=${"Buy Milk"} 
        .status=${"todo"}
      ></task-node-view>
    `);

    const dropdown = el.querySelector("dropdown-menu");
    expect(dropdown).to.exist;

    // 1. Get the trigger button from the Light DOM slot
    const trigger = dropdown!.querySelector('[slot="trigger"]') as HTMLElement;
    expect(trigger).to.exist;
    
    trigger.click();

    // 2. Find the "Done" option in the dropdown content
    // The component renders buttons for each status in slot="content"
    const buttons = Array.from(dropdown!.querySelectorAll('[slot="content"] button'));
    const doneButton = buttons.find(b => b.textContent?.includes("Done")) as HTMLElement;
    
    expect(doneButton).to.exist;

    // 3. Schedule the click for the next event loop tick so oneEvent can catch it
    setTimeout(() => doneButton.click());

    // 4. Wait for the event
    const ev = await oneEvent(el, "update-block-field");
    
    expect(ev).to.exist;
    expect(ev.detail).to.deep.equal({
      blockId: "block-123",
      key: "status",
      value: "done"
    });
  });
});
