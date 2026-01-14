// FILE: src/components/ui/entity-selector.ts
import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import * as select from "@zag-js/select";
import { ZagController } from "../../lib/client/zag/controller";
import { spreadProps, type Attrs } from "../../lib/client/zag/spread-props";
import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/clientLog";
import { effect } from "@preact/signals-core";
import { entityListState, startEntitySubscription } from "../../lib/client/stores/entityStore";

interface EntityItem {
  label: string;
  value: string;
  description: string;
}

@customElement("entity-selector")
export class EntitySelector extends LitElement {
  @property({ type: String }) value = "";
  @property({ type: String }) placeholder = "Select Entity / Asset";

  private _disposeEffect?: () => void;

  private ctrl = new ZagController(
    this,
    select.machine,
    () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return {
        id: "entity-select",
        collection: select.collection({
          items: entityListState.value.map((e) => ({
            label: e.name,
            value: e.id,
            description: e.description || "",
          })),
        }),
        value: this.value ? [this.value] : [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onValueChange: (details: any) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const newValue = details.value[0] as string;
          this.dispatchEvent(
            new CustomEvent("change", {
              detail: newValue || null,
              bubbles: true,
              composed: true,
            }),
          );
           
          runClientUnscoped(clientLog("info", "Entity selected", newValue));
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any; 
    },
    select.connect,
  );

  override connectedCallback() {
    super.connectedCallback();
    startEntitySubscription(); 
    
    this._disposeEffect = effect(() => {
      const entities = entityListState.value;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const api = this.ctrl.api as any;
      
      if (api) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        api.collection = select.collection({
            items: entities.map((e) => ({
                label: e.name,
                value: e.id,
                description: e.description || "",
            })),
        });
      }
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  protected override createRenderRoot() {
    return this; 
  }

  override updated() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const api = this.ctrl.api as any;

    if (!api) return;

    const root = this.querySelector("[data-part='root']");
    const label = this.querySelector("[data-part='label']");
    const trigger = this.querySelector("[data-part='trigger']");
    const positioner = this.querySelector("[data-part='positioner']");
    const content = this.querySelector("[data-part='content']");

    /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
    if (root) spreadProps(root as HTMLElement, api.getRootProps());
    if (label) spreadProps(label as HTMLElement, api.getLabelProps());
    if (trigger) spreadProps(trigger as HTMLElement, api.getTriggerProps());
    if (positioner) spreadProps(positioner as HTMLElement, api.getPositionerProps());
    if (content) spreadProps(content as HTMLElement, api.getContentProps());

    const items = this.querySelectorAll("[data-part='item']");
    items.forEach((el) => {
      const value = (el as HTMLElement).dataset.value;
      if (value) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const item = api.collection.items.find((i: EntityItem) => i.value === value);
        if (item) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          spreadProps(el as HTMLElement, api.getItemProps({ item }) as Attrs);
        }
      }
    });
    /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
  }

  override render() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const api = this.ctrl.api as any;

    if (!api) return nothing;

    /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    return html`
      <div data-part="root" class="relative w-full">
        <button
          data-part="trigger"
          class="flex w-full cursor-pointer items-center justify-between rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <span class="truncate">${api.valueAsString || this.placeholder}</span>
          <svg
            class="h-3 w-3 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            ></path>
          </svg>
        </button>

        <div data-part="positioner" class="z-[100] w-[var(--reference-width)]">
          <ul
            data-part="content"
            class="max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-xs"
          >
            ${api.collection.items.length === 0 
                ? html`<div class="px-3 py-2 text-zinc-400 italic">No entities found</div>`
                : api.collection.items.map(
                (item: EntityItem) => html`
                    <li
                    data-part="item"
                    data-value="${item.value}"
                    class="relative cursor-pointer select-none py-2 pl-3 pr-9 hover:bg-blue-50 data-[highlighted]:bg-blue-50"
                    >
                    <span class="block truncate font-medium text-zinc-900">${item.label}</span>
                    ${item.description ? html`<span class="block truncate text-[10px] text-zinc-500">${item.description}</span>` : nothing}
                    
                    ${api.value.includes(item.value)
                        ? html`
                            <span class="absolute inset-y-0 right-0 flex items-center pr-4 text-blue-600">
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                            </svg>
                            </span>
                        `
                        : nothing}
                    </li>
                `,
                )
            }
          </ul>
        </div>
      </div>
    `;
    /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
  }
}
