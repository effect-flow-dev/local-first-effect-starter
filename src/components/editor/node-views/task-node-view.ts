// FILE: src/components/editor/node-views/task-node-view.ts
import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { runClientUnscoped } from "../../../lib/client/runtime";
import { clientLog } from "../../../lib/client/clientLog";
import "../../ui/dropdown-menu";

export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

@customElement("task-node-view")
export class TaskNodeView extends LitElement {
  @property({ type: String })
  blockId: string = "";

  @property({ type: String })
  content: string = "";

  @property({ type: String })
  status: TaskStatus = "todo";

  // Keep for backward compatibility if needed
  @property({ type: Boolean })
  isComplete: boolean = false;

  private _getStatus(): TaskStatus {
    if (this.status && ["todo", "in_progress", "done", "blocked"].includes(this.status)) {
      return this.status;
    }
    return this.isComplete ? "done" : "todo";
  }

  private _handleStatusChange(newStatus: TaskStatus) {
    runClientUnscoped(clientLog("info", `[TaskNodeView] Status changing to ${newStatus}`));
    this.dispatchEvent(
      new CustomEvent("update-block-field", {
        bubbles: true,
        composed: true,
        detail: {
          blockId: this.blockId,
          key: "status",
          value: newStatus,
        },
      }),
    );
  }

  private _renderStatusBadge(status: TaskStatus) {
    const config = {
      todo: {
        icon: html`<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`,
        class: "text-zinc-400 hover:text-zinc-600",
        label: "To Do"
      },
      in_progress: {
        icon: html`<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
        class: "text-blue-500 hover:text-blue-600",
        label: "In Progress"
      },
      done: {
        icon: html`<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
        class: "text-green-500 hover:text-green-600",
        label: "Done"
      },
      blocked: {
        icon: html`<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`,
        class: "text-red-500 hover:text-red-600",
        label: "Blocked"
      }
    };

    const current = config[status] || config.todo;

    return html`
      <dropdown-menu>
        <button
          slot="trigger"
          class="flex items-center justify-center p-1 rounded transition-colors ${current.class}"
          title="${current.label}"
        >
          ${current.icon}
        </button>

        <div slot="content" class="flex flex-col min-w-[140px] py-1">
          ${Object.entries(config).map(([key, val]) => html`
            <button
              class="flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 ${key === status ? 'font-semibold bg-zinc-50' : 'text-zinc-600'}"
              @click=${() => this._handleStatusChange(key as TaskStatus)}
            >
              <span class="${val.class}">${val.icon}</span>
              <span>${val.label}</span>
            </button>
          `)}
        </div>
      </dropdown-menu>
    `;
  }

  override render() {
    const status = this._getStatus();
    const isDone = status === "done";
    const isBlocked = status === "blocked";

    const textClasses = {
      "flex-1": true,
      "ml-2": true,
      "text-zinc-800": !isDone && !isBlocked,
      "text-zinc-400": isDone,
      "line-through": isDone,
      "text-red-800": isBlocked, // Visual alert for blocked text
      "bg-red-50": isBlocked,
      "px-1": isBlocked,
      "rounded": isBlocked
    };

    // Note: The content span is rendered here for consistency, but the actual editable text
    // is managed by the parent interactive-node's contentDOM.
    return html`
      <div class="task-node-view flex items-start py-1">
        <!-- 
          We also set contenteditable="false" here as a fallback/guard, 
          although the parent Node View handles the host element.
        -->
        <div class="flex-shrink-0 mt-0.5 select-none" contenteditable="false">
          ${this._renderStatusBadge(status)}
        </div>
        <span class=${classMap(textClasses)}>${this.content}</span>
      </div>
    `;
  }

  protected override createRenderRoot() {
    return this;
  }
}
