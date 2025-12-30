// FILE: src/components/editor/extensions/AlertBlock.ts
import { Node, mergeAttributes, type NodeViewRendererProps } from "@tiptap/core";
import { type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type NodeView, type EditorView } from "@tiptap/pm/view";

export type AlertLevel = "info" | "warning" | "error";

interface AlertAttributes {
  level: AlertLevel;
  message: string;
  blockId: string | null;
}

class AlertBlockNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM?: HTMLElement; // undefined because this is an atom node (no content hole)
  node: ProseMirrorNode;
  view: EditorView;
  getPos: () => number | undefined;

  constructor(props: NodeViewRendererProps) {
    this.node = props.node;
    this.view = props.view;
    this.getPos = props.getPos;

    this.dom = document.createElement("div");
    this.dom.contentEditable = "false"; // Read-only
    this.render();
  }

  private getStyles(level: AlertLevel) {
    switch (level) {
      case "error":
        return {
          wrapper: "bg-red-50 border-red-500 text-red-800",
          iconColor: "text-red-500",
          iconPath:
            "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z", // Warning triangle
        };
      case "warning":
        return {
          wrapper: "bg-yellow-50 border-yellow-500 text-yellow-800",
          iconColor: "text-yellow-600",
          iconPath:
            "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z", // Warning triangle
        };
      case "info":
      default:
        return {
          wrapper: "bg-blue-50 border-blue-500 text-blue-800",
          iconColor: "text-blue-500",
          iconPath:
            "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", // Info circle
        };
    }
  }

  private _handleViewHistory = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Dispatch bubbling event to be caught by NotePage
    this.dom.dispatchEvent(new CustomEvent("view-history-request", {
      bubbles: true,
      composed: true
    }));
  };

  private render() {
    const attrs = this.node.attrs as unknown as AlertAttributes;
    const level = attrs.level || "warning";
    const message = attrs.message || "Alert";
    const styles = this.getStyles(level);

    // Reset classes
    this.dom.className = `alert-block group relative flex items-start gap-3 p-4 my-4 rounded-md border-l-4 shadow-sm select-none ${styles.wrapper}`;
    
    // Add data attribute for easier testing/querying
    this.dom.setAttribute("data-alert-level", level);

    // Icon
    const iconWrapper = document.createElement("div");
    iconWrapper.className = `flex-shrink-0 mt-0.5 ${styles.iconColor}`;
    iconWrapper.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="${styles.iconPath}" />
      </svg>
    `;

    // Content Container (Flex Column)
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "flex-1 flex flex-col gap-2";

    // Text Message
    const textDiv = document.createElement("div");
    textDiv.className = "text-sm font-medium leading-relaxed";
    textDiv.textContent = message;
    contentWrapper.appendChild(textDiv);

    // Action Button (Only for Conflicts/Errors)
    if (level === "error") {
      const btn = document.createElement("button");
      btn.className = "self-start px-3 py-1.5 bg-white border border-red-200 text-red-700 text-xs font-semibold rounded hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 transition-colors";
      btn.textContent = "View Version History";
      btn.onclick = this._handleViewHistory;
      contentWrapper.appendChild(btn);
    }

    this.dom.innerHTML = "";
    this.dom.appendChild(iconWrapper);
    this.dom.appendChild(contentWrapper);
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    // Check if attributes changed before re-rendering
    if (
      node.attrs.level !== this.node.attrs.level || 
      node.attrs.message !== this.node.attrs.message
    ) {
      this.node = node;
      this.render();
    }
    return true;
  }
}

export const AlertBlock = Node.create({
  name: "alertBlock",
  group: "block",
  atom: true, // It is a leaf node, no content inside managed by ProseMirror
  draggable: true, // Can be dragged around

  addAttributes() {
    return {
      blockId: {
        default: null,
      },
      level: {
        default: "warning",
        renderHTML: (attributes) => ({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          "data-level": attributes.level,
        }),
      },
      message: {
        default: "",
        renderHTML: (attributes) => ({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          "data-message": attributes.message,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-alert-block]",
        getAttrs: (element) => {
          if (typeof element === "string") return {};
          return {
            level: element.getAttribute("data-level"),
            message: element.getAttribute("data-message"),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-alert-block": "" }),
    ];
  },

  addNodeView() {
    return (props) => new AlertBlockNodeView(props);
  },
});
