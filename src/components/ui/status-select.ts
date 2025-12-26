/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import * as select from "@zag-js/select";
import { ZagController } from "../../lib/client/zag/controller";
import { spreadProps } from "../../lib/client/zag/spread-props";
import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/clientLog";
// I18n
import { effect } from "@preact/signals-core";
import { localeState, t } from "../../lib/client/stores/i18nStore";

@customElement("status-select")
export class StatusSelect extends LitElement {
  @property({ type: String }) label = "";
  @property({ type: String }) value = "";

  private _disposeEffect?: () => void;

  // Initialize the Zag Machine Controller with dynamic props function
  private ctrl = new ZagController(
    this,
    select.machine,
    () => ({
      id: "status-select",
      // Collection is created dynamically based on current language
      collection: select.collection({
        items: [
          { label: t("status.draft"), value: "draft" },
          { label: t("status.review"), value: "review" },
          { label: t("status.published"), value: "published" },
        ],
      }),
      value: this.value ? [this.value] : [],
      onValueChange: (details: any) => {
        const newValue = details.value[0];
        this.dispatchEvent(
          new CustomEvent("change", {
            detail: newValue,
            bubbles: true,
            composed: true,
          }),
        );
        runClientUnscoped(clientLog("info", "Status changed", newValue));
      },
    }) as any,
    select.connect,
  );

  override connectedCallback() {
    super.connectedCallback();
    this._disposeEffect = effect(() => {
      void localeState.value;
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
    const api = this.ctrl.api as any;
    if (!api) return;

    const root = this.querySelector("[data-part='root']");
    const label = this.querySelector("[data-part='label']");
    const trigger = this.querySelector("[data-part='trigger']");
    const positioner = this.querySelector("[data-part='positioner']");
    const content = this.querySelector("[data-part='content']");

    if (root) spreadProps(root as HTMLElement, api.getRootProps());
    if (label) spreadProps(label as HTMLElement, api.getLabelProps());
    if (trigger) spreadProps(trigger as HTMLElement, api.getTriggerProps());
    if (positioner)
      spreadProps(positioner as HTMLElement, api.getPositionerProps());
    if (content) spreadProps(content as HTMLElement, api.getContentProps());

    const items = this.querySelectorAll("[data-part='item']");
    items.forEach((el) => {
      const value = (el as HTMLElement).dataset.value;
      if (value) {
        const item = api.collection.items.find((i: any) => i.value === value);
        if (item) {
          spreadProps(el as HTMLElement, api.getItemProps({ item }));
        }
      }
    });
  }

  override render() {
    const api = this.ctrl.api as any;
    if (!api) return nothing;

    const labelText = this.label || t("status.label");

    return html`
      <div data-part="root" class="relative w-full max-w-[200px]">
        <label
          data-part="label"
          class="mb-1 block text-sm font-medium text-zinc-700"
        >
          ${labelText}
        </label>

        <button
          data-part="trigger"
          class="flex w-full cursor-pointer items-center justify-between rounded-md border border-zinc-300 bg-white px-3 py-2 text-left shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 sm:text-sm"
        >
          <span>${api.valueAsString || t("status.select")}</span>
          <svg
            class="h-4 w-4 text-zinc-400"
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

        <div data-part="positioner" class="z-50 w-[var(--reference-width)]">
          <ul
            data-part="content"
            class="max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
          >
            ${api.collection.items.map(
              (item: any) => html`
                <li
                  data-part="item"
                  data-value="${item.value}"
                  class="relative cursor-pointer select-none py-2 pl-3 pr-9 hover:bg-zinc-100 data-[highlighted]:bg-zinc-100"
                >
                  <span
                    class="block truncate font-normal data-[selected]:font-semibold"
                  >
                    ${item.label}
                  </span>
                  ${api.value.includes(item.value)
                    ? html`
                        <span
                          class="absolute inset-y-0 right-0 flex items-center pr-4 text-zinc-600"
                        >
                          <svg
                            class="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M5 13l4 4L19 7"
                            ></path>
                          </svg>
                        </span>
                      `
                    : nothing}
                </li>
              `,
            )}
          </ul>
        </div>
      </div>
    `;
  }
}
