// FILE: src/components/editor/extensions/FocusBlock.ts
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const FocusBlock = Extension.create({
  name: "focusBlock",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("focusBlock"),
        props: {
          decorations: (state) => {
            const { selection } = state;
            const { $from } = selection;

            // Find the current block node
            // We want the direct child of the doc, or the closest "block" node
            // that our NotionBlock/InteractiveNode logic wraps.
            // Usually depth 1 is the top-level block in the doc.
            let currentDepth = $from.depth;
            let targetPos = -1;
            let targetNode = null;

            while (currentDepth > 0) {
              const node = $from.node(currentDepth);
              // Check if this is one of our block types that has a handle
              if (
                [
                  "paragraph",
                  "heading",
                  "bulletList",
                  "listItem",
                  "interactiveBlock",
                ].includes(node.type.name)
              ) {
                targetNode = node;
                // Get the position before this node starts
                targetPos = $from.before(currentDepth);
                break;
              }
              currentDepth--;
            }

            if (targetNode && targetPos !== -1) {
              return DecorationSet.create(state.doc, [
                Decoration.node(targetPos, targetPos + targetNode.nodeSize, {
                  class: "is-active",
                }),
              ]);
            }

            return DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
