// src/components/editor/extensions/StableId.ts
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { v4 as uuidv4 } from "uuid";
import { clientLog } from "../../../lib/client/clientLog";
import { runClientUnscoped } from "../../../lib/client/runtime";

export const StableId = Extension.create({
  name: "stableId",

  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "bulletList",
          "listItem",
          "interactiveBlock",
        ],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-block-id"),
            renderHTML: (attributes: Record<string, unknown>) => {
              const { blockId } = attributes as { blockId?: string | null };
              if (!blockId) {
                return {};
              }
              return {
                "data-block-id": blockId,
              };
            },
            // Prevent duplication of the same ID when splitting nodes
            keepOnSplit: false,
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("stableId"),
        appendTransaction: (transactions, _oldState, newState) => {
          // Only check if the document content has changed
          if (!transactions.some((tr) => tr.docChanged)) {
            return null;
          }

          const tr = newState.tr;
          let modified = false;
          const seenIds = new Set<string>();

          // Iterate through all nodes to ensure they have a UNIQUE blockId
          newState.doc.descendants((node, pos) => {
            const isTargetNode = [
              "paragraph",
              "heading",
              "bulletList",
              "listItem",
              "interactiveBlock",
            ].includes(node.type.name);

            if (isTargetNode) {
              const currentId = node.attrs.blockId as string | undefined;

              // If ID is missing OR we've already seen this ID in this pass (duplicate)
              // then generate a new unique ID.
              if (!currentId || seenIds.has(currentId)) {
                const newId = uuidv4();
                
                // ✅ DEBUG LOG: Inspect text content to identify the culprit
                const textContent = node.textContent?.slice(0, 20) || "(empty)";
                
                runClientUnscoped(
                  clientLog("debug", "[StableId] Generated new ID", {
                    type: node.type.name,
                    contentSnippet: textContent,
                    oldId: currentId || "none",
                    newId: newId,
                    reason: !currentId ? "missing" : "duplicate",
                  })
                );

                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  blockId: newId,
                });
                modified = true;
                seenIds.add(newId);
              } else {
                seenIds.add(currentId);
              }
            }
          });

          if (modified) {
            return tr;
          }
          return null;
        },
      }),
    ];
  },
});
