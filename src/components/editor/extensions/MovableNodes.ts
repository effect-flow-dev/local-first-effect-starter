// src/components/editor/extensions/MovableNodes.ts
import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { CommandProps } from "@tiptap/core"; // ✅ 1. IMPORT CommandProps FOR TYPING

// ✅ 2. DECLARE THE NEW COMMANDS IN THE TIPTAP/CORE MODULE
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    movableNodes: {
      /**
       * Move a list item up
       */
      moveNodeUp: () => ReturnType;
      /**
       * Move a list item down
       */
      moveNodeDown: () => ReturnType;
    };
  }
}

/**
 * A helper function to move a node up or down.
 */
const moveNode = (
  direction: "up" | "down",
  // ✅ 3. USE CommandProps FOR CORRECT TYPING
): ((props: CommandProps) => boolean) => {
  return ({ tr, dispatch }) => {
    const { $from, $to } = tr.selection;

    if ($from.pos !== $to.pos) {
      return false;
    }

    const node = $from.node(-1);
    if (node.type.name !== "listItem") {
      return false;
    }

    const currentIndex = $from.index(-1);
    const parentList = $from.node(-2);
    const listStartPosition = $from.start(-2);

    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (newIndex < 0 || newIndex >= parentList.childCount) {
      return false;
    }

    const nodeSize = node.nodeSize;
    const currentPos = $from.start(-1);

    let targetPos = listStartPosition;
    for (let i = 0; i < newIndex; i++) {
      targetPos += parentList.child(i).nodeSize;
    }

    if (dispatch) {
      tr.delete(currentPos, currentPos + nodeSize);
      tr.insert(targetPos, node);

      const resolvedPos = tr.doc.resolve(tr.mapping.map(targetPos) - nodeSize);
      tr.setSelection(TextSelection.near(resolvedPos));

      dispatch(tr.scrollIntoView());
    }

    return true;
  };
};

/**
 * Tiptap extension to allow moving list items up and down with keyboard shortcuts.
 */
export const MovableNodes = Extension.create({
  name: "movableNodes", // ✅ 4. NAME THE COMMAND GROUP

  addCommands() {
    return {
      moveNodeUp: () => (props) => moveNode("up")(props),
      moveNodeDown: () => (props) => moveNode("down")(props),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Alt-k": () => this.editor.commands.moveNodeUp(),
      "Alt-j": () => this.editor.commands.moveNodeDown(),
    };
  },
});
