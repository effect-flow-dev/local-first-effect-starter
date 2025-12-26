// FILE: src/components/editor/extensions/NotionBlock.ts
import { NodeViewRendererProps } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeView, EditorView } from "@tiptap/pm/view";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Heading } from "@tiptap/extension-heading";

/**
 * A generic Node View that wraps blocks (Paragraphs, Headings).
 * Previously contained a drag handle, now simplified to just a wrapper
 * for potential future metadata or styling, without the sidebar gutter.
 */
export class NotionBlockNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  node: ProseMirrorNode;
  view: EditorView;
  getPos: () => number | undefined;

  constructor(props: NodeViewRendererProps) {
    this.node = props.node;
    this.view = props.view;
    this.getPos = props.getPos;

    // 1. Main Wrapper
    this.dom = document.createElement("div");

    // Determine spacing classes based on node type
    const spacingClasses = ["my-1"]; 
    
    if (this.node.type.name === "heading") {
        const level = this.node.attrs.level as number;
        if (level === 1) {
            spacingClasses.length = 0;
            spacingClasses.push("mt-6", "mb-4");
        } else if (level === 2) {
            spacingClasses.length = 0;
            spacingClasses.push("mt-5", "mb-3");
        } else if (level === 3) {
            spacingClasses.length = 0;
            spacingClasses.push("mt-4", "mb-2");
        }
    }

    this.dom.classList.add(
      "notion-block",
      "group",
      "relative",
      "flex",
      "items-start",
      // Removed sidebar offset classes (-ml-12, pl-12)
      ...spacingClasses
    );

    if (this.node.attrs.blockId) {
      this.dom.setAttribute("data-block-id", this.node.attrs.blockId as string);
    }

    // 2. Drag Handle REMOVED

    // 3. Content Area
    const tag =
      this.node.type.name === "heading" ? `h${this.node.attrs.level}` : "p";
    this.contentDOM = document.createElement(tag);
    this.contentDOM.classList.add(
      "flex-1",
      "min-w-0",
      "!my-0", 
      "leading-normal",
    );

    this.dom.appendChild(this.contentDOM);
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    
    if (node.type.name === "heading" && node.attrs.level !== this.node.attrs.level) {
        return false;
    }

    this.node = node;
    if (this.node.attrs.blockId) {
      this.dom.setAttribute("data-block-id", this.node.attrs.blockId as string);
    }
    return true;
  }
}

export const NotionParagraph = Paragraph.extend({
  addNodeView() {
    return (props) => new NotionBlockNodeView(props);
  },
});

export const NotionHeading = Heading.extend({
  addNodeView() {
    return (props) => new NotionBlockNodeView(props);
  },
});
