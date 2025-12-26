// FILE: src/components/ui/notion-select.ts
import { html, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";

export interface SelectOption {
  label: string;
  value: string;
}

interface NotionSelectProps {
  id: string;
  label: string;
  value?: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange?: (e: Event) => void;
}

/**
 * A functional, stateless select component styled to match NotionInput.
 */
export const NotionSelect = (props: NotionSelectProps): TemplateResult => {
  const { id, label, value, options, disabled = false, onChange } = props;

  const labelClasses = {
    block: true,
    "text-sm": true,
    "font-medium": true,
    "text-zinc-700": true,
  };

  const selectClasses = {
    "mt-1": true,
    block: true,
    "w-full": true,
    "rounded-md": true,
    border: true,
    "border-zinc-300": true,
    "bg-white": true,
    "px-3": true,
    "py-2": true,
    "shadow-sm": true,
    "focus:border-zinc-500": true,
    "focus:outline-none": true,
    "focus:ring-zinc-500": true,
    "sm:text-sm": true,
    "disabled:pointer-events-none": true,
    "disabled:bg-zinc-100": true,
  };

  return html`
    <div>
      <label for=${id} class=${classMap(labelClasses)}>${label}</label>
      <select
        id=${id}
        name=${id}
        ?disabled=${disabled}
        @change=${onChange}
        class=${classMap(selectClasses)}
      >
        ${options.map(
          (opt) => html`
            <option value=${opt.value} ?selected=${opt.value === value}>
              ${opt.label}
            </option>
          `,
        )}
      </select>
    </div>
  `;
};
