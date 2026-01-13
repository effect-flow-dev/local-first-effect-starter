// FILE: src/components/editor/extensions/InteractiveNode.ts
import {
  Node,
  NodeViewRenderer,
  textblockTypeInputRule,
  type Attribute,
} from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { type Node as ProsemirrorNode } from "@tiptap/pm/model";
import { v4 as uuidv4 } from "uuid";
import { clientLog } from "../../../lib/client/clientLog";
import { runClientUnscoped } from "../../../lib/client/runtime";

// Logic Imports
import { type InteractiveNodeAttributes, type InteractiveProsemirrorNode } from "./InteractiveNode.types";
import { handleFileInsert } from "./InteractiveNode.handlers";
import { InteractiveBlockNodeView } from "./InteractiveNode.view";

const TASK_INPUT_REGEX_SIMPLE = /^\[( |x|\/|!)?\]\s$/i;
const TASK_INPUT_REGEX_DASH = /^-\s\[( |x|\/|!)?\]\s$/i;

export const InteractiveNode = Node.create<{
  attributes: InteractiveNodeAttributes;
}>({
  name: "interactiveBlock",
  group: "block",
  content: "inline*",
  draggable: true,

  addAttributes(): { [key in keyof InteractiveNodeAttributes]: Attribute } {
    return {
      blockId: {
        default: null,
      },
      version: {
        default: 1,
      },
      blockType: { default: "text" },
      fields: { default: {} },
    };
  },

  parseHTML() {
    return [{ tag: `div[data-interactive-block]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-interactive-block": "" }, 0];
  },

  addNodeView(): NodeViewRenderer {
    return ({ node, view, getPos }) => {
      return new InteractiveBlockNodeView(
        node as InteractiveProsemirrorNode,
        view,
        getPos,
      );
    };
  },

  addInputRules() {
    const getAttributes = (
      match: RegExpMatchArray,
    ): InteractiveNodeAttributes => {
      const mark = match[1]?.toLowerCase();
      let status: "todo" | "in_progress" | "done" | "blocked" = "todo";
      let isComplete = false;

      if (mark === "x") {
        status = "done";
        isComplete = true;
      } else if (mark === "/") {
        status = "in_progress";
      } else if (mark === "!") {
        status = "blocked";
      }

      return {
        blockId: uuidv4(),
        blockType: "task",
        fields: {
          is_complete: isComplete,
          status: status,
        },
      };
    };

    return [
      textblockTypeInputRule({
        find: TASK_INPUT_REGEX_SIMPLE,
        type: this.type,
        getAttributes,
      }),
      textblockTypeInputRule({
        find: TASK_INPUT_REGEX_DASH,
        type: this.type,
        getAttributes,
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const { selection } = state;
        const { $from, empty } = selection;

        if (!empty || $from.parent.content.size !== $from.parentOffset) {
          return false;
        }

        if ($from.parent.type.name !== this.type.name) {
          return false;
        }

        // Handle enter on Image or File Attachment blocks: Create new text block below
        if ($from.parent.attrs.blockType === "image" || $from.parent.attrs.blockType === "file_attachment") {
          return this.editor.commands.insertContentAt($from.after(), {
            type: this.type.name,
            attrs: {
              blockId: uuidv4(),
              blockType: "text",
              fields: {},
            } as InteractiveNodeAttributes,
          });
        }

        if (
          $from.parent.content.size === 0 &&
          $from.parent.attrs.blockType === "task"
        ) {
          return this.editor
            .chain()
            .updateAttributes(this.type.name, {
              blockType: "text",
              fields: {},
            })
            .run();
        }

        return this.editor.commands.insertContentAt($from.after(), {
          type: this.type.name,
          attrs: {
            blockId: uuidv4(),
            blockType: "task",
            fields: { is_complete: false, status: "todo" },
          } as InteractiveNodeAttributes,
        });
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("interactiveNodeHandlers"),
        props: {
          handlePaste: (view, event) => {
            const html = event.clipboardData?.getData("text/html");
            if (html) {
              const div = document.createElement("div");
              div.innerHTML = html;
              const img = div.querySelector("img");
              const textContent = div.textContent || "";
              
              if (img && img.src && textContent.trim().length === 0) {
                 if (img.src.startsWith("http")) {
                    if (runClientUnscoped) {
                        runClientUnscoped(clientLog("info", "[InteractiveNode] Handling pasted image URL (GIF support)", { url: img.src }));
                    }
                    
                    const nodeType = view.state.schema.nodes.interactiveBlock;
                    if (nodeType) {
                      const node = nodeType.create({
                          blockId: uuidv4(),
                          blockType: "image",
                          fields: {
                              url: img.src,
                          },
                      });
                      
                      const transaction = view.state.tr.insert(
                          view.state.selection.from,
                          node
                      );
                      view.dispatch(transaction);
                      event.preventDefault();
                      return true;
                    }
                 }
              }
            }

            const items = event.clipboardData?.items;
            if (!items) return false;

            if (runClientUnscoped) {
                runClientUnscoped(clientLog("debug", "[InteractiveNode] handlePaste triggered", { itemCount: items.length }));
            }

            for (const item of Array.from(items)) {
              // ✅ MODIFIED: Allow any file kind, not just images
              if (item.kind === "file") {
                const file = item.getAsFile();
                if (file) {
                  if (runClientUnscoped) {
                      runClientUnscoped(clientLog("debug", "[InteractiveNode] File found", { name: file.name, type: file.type }));
                  }
                  event.preventDefault();
                  handleFileInsert(view, file);
                  return true;
                }
              }
            }
            return false;
          },
          handleDrop: (view, event) => {
            const hasFiles = event.dataTransfer?.files?.length;
            if (!hasFiles) return false;
            
            if (runClientUnscoped) {
                runClientUnscoped(clientLog("debug", "[InteractiveNode] handleDrop triggered", { fileCount: event.dataTransfer?.files.length }));
            }

            // ✅ MODIFIED: Accept all files, not just images
            const files = Array.from(event.dataTransfer.files);
            
            if (files.length > 0) {
              event.preventDefault();
              const coordinates = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              if (coordinates) {
                files.forEach((file) =>
                  handleFileInsert(view, file, coordinates.pos),
                );
              }
              return true;
            }
            return false;
          },
        },
        appendTransaction: (transactions, _oldState, newState) => {
          const dropTransaction = transactions.find(
            (tr) => tr.getMeta("uiEvent") === "drop" && tr.docChanged,
          );

          if (!dropTransaction) {
            return null;
          }

          let dropPos = -1;
          let droppedNode: ProsemirrorNode | null | undefined = null;

          for (const step of dropTransaction.steps) {
            if (
              step instanceof ReplaceStep &&
              step.slice.size > 0 &&
              step.slice.content.firstChild?.type.name === this.type.name
            ) {
              dropPos = step.from;
              droppedNode = step.slice.content.firstChild;
              break;
            }
          }

          if (dropPos !== -1 && droppedNode) {
            const endOfNodeContentPos = dropPos + 1 + droppedNode.content.size;
            return newState.tr.setSelection(
              TextSelection.create(newState.doc, endOfNodeContentPos),
            );
          }

          return null;
        },
      }),
    ];
  },
});
