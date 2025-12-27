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

    @property({ type: String })
    dueAt: string = "";

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
        this._dispatchUpdate("status", newStatus);
    }

    // ✅ FIX: Use arrow function property to automatically bind 'this', preventing unbound method errors
    private _handleDateChange = (e: Event) => {
        const input = e.target as HTMLInputElement;
        const value = input.value; // YYYY-MM-DDTHH:mm
        
        // Convert to ISO string or empty
        const isoString = value ? new Date(value).toISOString() : "";
        
        runClientUnscoped(clientLog("info", `[TaskNodeView] Due date changed to ${isoString}`));
        this._dispatchUpdate("due_at", isoString);
    }

    private _dispatchUpdate(key: string, value: unknown) {
        this.dispatchEvent(
            new CustomEvent("update-block-field", {
                bubbles: true,
                composed: true,
                detail: {
                    blockId: this.blockId,
                    key,
                    value,
                },
            }),
        );
    }

    private _formatDueDate(isoString: string) {
        if (!isoString) return null;
        const date = new Date(isoString);
        const now = new Date();
        const isOverdue = date < now;
        
        const text = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        return html`
            <span class="ml-2 text-xs px-1.5 py-0.5 rounded border ${isOverdue ? 'bg-red-50 text-red-600 border-red-200' : 'bg-zinc-50 text-zinc-500 border-zinc-200'}">
                ${text}
            </span>
        `;
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
        
        let inputValue = "";
        if (this.dueAt) {
            const d = new Date(this.dueAt);
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            inputValue = d.toISOString().slice(0, 16);
        }

        return html`
            <dropdown-menu>
                <button
                    slot="trigger"
                    class="flex items-center justify-center p-1 rounded transition-colors ${current.class}"
                    title="${current.label}"
                >
                    ${current.icon}
                </button>

                <div slot="content" class="flex flex-col min-w-[200px] py-1 bg-white border border-zinc-200 rounded-md shadow-lg">
                    <div class="px-2 py-1 text-xs font-semibold text-zinc-400 uppercase">Status</div>
                    ${Object.entries(config).map(([key, val]) => html`
                        <button
                            class="flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 ${key === status ? 'font-semibold bg-zinc-50' : 'text-zinc-600'}"
                            @click=${() => this._handleStatusChange(key as TaskStatus)}
                        >
                            <span class="${val.class}">${val.icon}</span>
                            <span>${val.label}</span>
                        </button>
                    `)}
                    
                    <div class="border-t border-zinc-100 my-1"></div>
                    
                    <div class="px-2 py-1 text-xs font-semibold text-zinc-400 uppercase">Due Date</div>
                    <div class="px-3 py-2">
                        <input 
                            type="datetime-local" 
                            class="w-full text-sm border border-zinc-300 rounded px-2 py-1"
                            .value=${inputValue}
                            @change=${this._handleDateChange}
                        />
                    </div>
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
            "text-red-800": isBlocked,
            "bg-red-50": isBlocked,
            "px-1": isBlocked,
            "rounded": isBlocked
        };

        return html`
            <div class="task-node-view flex items-start py-1">
                <div class="flex-shrink-0 mt-0.5 select-none flex items-center" contenteditable="false">
                    ${this._renderStatusBadge(status)}
                </div>
                <span class=${classMap(textClasses)}>${this.content}</span>
                <div class="flex-shrink-0 select-none" contenteditable="false">
                    ${this._formatDueDate(this.dueAt)}
                </div>
            </div>
        `;
    }

    protected override createRenderRoot() {
        return this;
    }
}
