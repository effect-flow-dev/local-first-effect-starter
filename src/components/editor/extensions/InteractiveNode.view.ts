// FILE: src/components/editor/extensions/InteractiveNode.view.ts
import type { NodeView, EditorView } from "@tiptap/pm/view";
import type { Node as ProsemirrorNode } from "@tiptap/pm/model";
import type { InteractiveProsemirrorNode, BlockFieldUpdateDetail } from "./InteractiveNode.types";
import { effect } from "@preact/signals-core"; 
import { presenceState } from "../../../lib/client/stores/presenceStore"; 
import { authState } from "../../../lib/client/stores/authStore"; 

import "../node-views/task-node-view";
import "../node-views/image-block-node-view";
import "../node-views/file-attachment-node-view";

export class InteractiveBlockNodeView implements NodeView {
  public dom: HTMLElement;
  public contentDOM: HTMLElement;
  
  private taskView?: HTMLElement; 
  private imageComponent?: HTMLElement;
  private fileComponent?: HTMLElement;

  private node: InteractiveProsemirrorNode;

  private _disposeEffect?: () => void;

  constructor(
    node: InteractiveProsemirrorNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.draggable = true;
    this.dom.classList.add(
      "interactive-block",
      "group",
      "relative",
      "flex",
      "items-start",
      "py-1",
    );

    if (this.node.attrs.blockId) {
      this.dom.setAttribute("data-block-id", this.node.attrs.blockId);
    }

    this.dom.addEventListener("delete-block", this.handleDelete);
    this.dom.addEventListener("update-block-field", this.handleBlockFieldUpdate as EventListener);

    this.contentDOM = document.createElement("div");
    this.contentDOM.classList.add("flex-1", "min-w-0");

    this.dom.appendChild(this.contentDOM);

    this.renderSpecificContent();

    // Setup Presence Monitoring
    this._disposeEffect = effect(() => {
      const blockId = this.node.attrs.blockId;
      if (!blockId) return;

      const users = presenceState.value[blockId] || [];
      const currentUserId = authState.value.user?.id;

      const remoteUsers = users.filter(u => u.userId !== currentUserId);
      const hasRemoteUser = remoteUsers.length > 0;

      if (hasRemoteUser) {
        this.dom.classList.add("is-remote-locked");
        const names = remoteUsers.map(u => u.userId.slice(0, 4)).join(", ");
        this.dom.setAttribute("title", `Locked by: ${names}`);
      } else {
        this.dom.classList.remove("is-remote-locked");
        this.dom.removeAttribute("title");
      }
    });
  }

  private handleDelete = (e: Event) => {
    e.stopPropagation();
    const pos = this.getPos();
    if (typeof pos === "number") {
      this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    }
  };

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: globalThis.Node }): boolean {
    if (this.contentDOM && (this.contentDOM === mutation.target || this.contentDOM.contains(mutation.target))) {
      return false;
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as globalThis.Node;
    if (this.taskView && this.taskView.contains(target)) return true;
    if (this.imageComponent && this.imageComponent.contains(target)) return true;
    if (this.fileComponent && this.fileComponent.contains(target)) return true;
    return false;
  }

  private renderSpecificContent() {
    const type = this.node.attrs.blockType;

    if (this.taskView) {
      this.taskView.remove();
      this.taskView = undefined;
    }
    if (this.imageComponent) {
      this.imageComponent.remove();
      this.imageComponent = undefined;
    }
    if (this.fileComponent) {
      this.fileComponent.remove();
      this.fileComponent = undefined;
    }

    const fields = this.node.attrs.fields;

    if (type === "task") {
      this.taskView = document.createElement("task-node-view");
      this.taskView.contentEditable = "false"; 

      const status = fields?.status || (fields?.is_complete ? "done" : "todo");
      const dueAt = fields?.due_at || "";
      
      this.taskView.setAttribute("status", status);
      if (dueAt) {
          this.taskView.setAttribute("dueAt", dueAt);
      }
      if (fields?.is_complete) {
        this.taskView.setAttribute("isComplete", "true");
      }
      
      if (this.contentDOM.parentNode !== this.dom) {
        this.dom.appendChild(this.contentDOM);
      }
      this.dom.insertBefore(this.taskView, this.contentDOM);
      
    } else if (type === "image") {
      this.imageComponent = document.createElement("image-block-node-view");
      this.imageComponent.contentEditable = "false";
      
      this.imageComponent.style.display = "block";
      this.imageComponent.style.width = "100%";

      if (fields.url) this.imageComponent.setAttribute("url", fields.url);
      if (fields.uploadId) this.imageComponent.setAttribute("uploadId", fields.uploadId);

      this.dom.appendChild(this.imageComponent);
      this.dom.appendChild(this.contentDOM);
      this.contentDOM.setAttribute("data-placeholder", "Write a caption...");
      this.contentDOM.classList.add("text-sm", "text-zinc-500", "mt-1");

    } else if (type === "file_attachment") {
        this.fileComponent = document.createElement("file-attachment-node-view");
        this.fileComponent.contentEditable = "false";
        this.fileComponent.style.display = "block";
        this.fileComponent.style.width = "100%";

        if (fields.filename) this.fileComponent.setAttribute("filename", fields.filename);
        if (fields.size) this.fileComponent.setAttribute("size", String(fields.size));
        if (fields.mimeType) this.fileComponent.setAttribute("mimeType", fields.mimeType);
        if (fields.url) this.fileComponent.setAttribute("url", fields.url);
        if (fields.uploadId) this.fileComponent.setAttribute("uploadId", fields.uploadId);

        this.dom.appendChild(this.fileComponent);
        this.dom.appendChild(this.contentDOM); 

    } else {
      this.dom.appendChild(this.contentDOM);
    }
  }

  private handleBlockFieldUpdate = (e: Event) => {
    const customEvent = e as CustomEvent<BlockFieldUpdateDetail>;
    const { key, value } = customEvent.detail;
    
    const pos = this.getPos();
    if (typeof pos !== "number") return;

    const currentFields = this.node.attrs.fields as Record<string, unknown>;
    const newFields = { ...currentFields, [key]: value };
    
    if (key === "status") {
      newFields.is_complete = value === "done";
    }

    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      fields: newFields,
    });
    this.view.dispatch(tr);
    
    this.view.dom.dispatchEvent(
        new CustomEvent("update-block-field", {
            bubbles: true, 
            detail: { blockId: this.node.attrs.blockId, key, value }
        })
    );
  };

  update(node: ProsemirrorNode): boolean {
    if (node.type.name !== this.node.type.name) return false;
    if (node.attrs.blockType !== this.node.attrs.blockType) return false;

    this.node = node as InteractiveProsemirrorNode;
    const fields = this.node.attrs.fields;

    if (this.node.attrs.blockId) {
      this.dom.setAttribute("data-block-id", this.node.attrs.blockId);
    }

    if (this.node.attrs.blockType === "task" && this.taskView) {
      const status = fields?.status || (fields?.is_complete ? "done" : "todo");
      const dueAt = fields?.due_at || "";
      
      this.taskView.setAttribute("status", status);
      if (dueAt) {
          this.taskView.setAttribute("dueAt", dueAt);
      } else {
          this.taskView.removeAttribute("dueAt");
      }
    }

    if (this.node.attrs.blockType === "image" && this.imageComponent) {
      if (fields.url) {
        this.imageComponent.setAttribute("url", fields.url);
      } else {
        this.imageComponent.removeAttribute("url");
      }
      if (fields.uploadId) {
        this.imageComponent.setAttribute("uploadId", fields.uploadId);
      }
    }

    if (this.node.attrs.blockType === "file_attachment" && this.fileComponent) {
        if (fields.url) this.fileComponent.setAttribute("url", fields.url);
        else this.fileComponent.removeAttribute("url");

        if (fields.uploadId) {
            this.fileComponent.setAttribute("uploadId", fields.uploadId);
        } else {
            this.fileComponent.removeAttribute("uploadId");
        }
        
        if (fields.filename) this.fileComponent.setAttribute("filename", fields.filename);
        if (fields.size) this.fileComponent.setAttribute("size", String(fields.size));
        if (fields.mimeType) this.fileComponent.setAttribute("mimeType", fields.mimeType);
    }

    return true;
  }

  destroy() {
    this.dom.removeEventListener("delete-block", this.handleDelete);
    this.dom.removeEventListener("update-block-field", this.handleBlockFieldUpdate as EventListener);
    
    // ✅ 4. Lifecycle Management: Cleanup reactive subscription
    this._disposeEffect?.();
  }
}
