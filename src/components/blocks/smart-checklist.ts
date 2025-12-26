// FILE: src/components/blocks/smart-checklist.ts
import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/clientLog";

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

@customElement("smart-checklist")
export class SmartChecklist extends LitElement {
  @property({ type: String }) blockId = "";
  @property({ type: Array }) items: ChecklistItem[] = [];

  // We use Light DOM to leverage global Tailwind styles
  protected override createRenderRoot() {
    return this;
  }

  private _toggleItem(id: string) {
    const itemIndex = this.items.findIndex((i) => i.id === id);
    if (itemIndex === -1) return;

    // 1. Local Optimistic Update (Mutable for performance/simplicity in Lit)
    const newItems = [...this.items];
    const item = { ...newItems[itemIndex]! };
    item.checked = !item.checked;
    newItems[itemIndex] = item;

    // Trigger local re-render immediately
    this.items = newItems;

    runClientUnscoped(clientLog("info", `[Checklist] Toggled item ${id} to ${item.checked}`));

    // 2. Dispatch Event for Persistence
    this.dispatchEvent(
      new CustomEvent("update-block", {
        bubbles: true,
        composed: true,
        detail: {
          blockId: this.blockId,
          fields: { items: newItems },
        },
      })
    );
  }

  override render() {
    return html`
      <div class="flex flex-col gap-3 my-4 select-none">
        ${repeat(
          this.items,
          (item) => item.id,
          (item) => {
            const isChecked = item.checked;
            
            // "Fat Finger" Styles
            const containerClasses = isChecked
              ? "bg-green-50 border-green-500 shadow-sm"
              : "bg-white border-zinc-300 shadow-sm";
            
            const textClasses = isChecked
              ? "text-green-800 font-semibold"
              : "text-zinc-700";

            return html`
              <div
                class="flex items-center justify-between p-4 rounded-lg border-2 cursor-pointer transition-all duration-150 active:scale-[0.99] ${containerClasses}"
                @click=${() => this._toggleItem(item.id)}
              >
                <span class="text-lg ${textClasses}">${item.label}</span>
                
                <!-- Huge Toggle Indicator -->
                <div 
                  class="flex items-center justify-center w-12 h-12 rounded-full border-2 transition-colors ${isChecked ? 'bg-green-500 border-green-600 text-white' : 'bg-zinc-100 border-zinc-300 text-transparent'}"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
              </div>
            `;
          }
        )}
      </div>
    `;
  }
}
