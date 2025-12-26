// FILE: src/components/features/language-switcher.ts
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import { localeState, setLocale, type Locale } from "../../lib/client/stores/i18nStore";
import "../ui/dropdown-menu";

@customElement("language-switcher")
export class LanguageSwitcher extends LitElement {
  private _disposeEffect?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    // Subscribe to locale changes to update the "EN/ES/JA" label
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

  private _handleSelect(code: Locale) {
    setLocale(code);
  }

  override render() {
    const current = localeState.value;

    return html`
      <dropdown-menu>
        <button
          slot="trigger"
          class="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
          title="Change Language"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
          </svg>
          <span class="uppercase">${current}</span>
        </button>

        <div slot="content" class="flex flex-col min-w-[100px]">
          <button
            class="px-4 py-2 text-left text-sm hover:bg-zinc-100 ${current === 'en' ? 'font-bold text-zinc-900' : 'text-zinc-600'}"
            @click=${() => this._handleSelect('en')}
          >
            English
          </button>
          <button
            class="px-4 py-2 text-left text-sm hover:bg-zinc-100 ${current === 'es' ? 'font-bold text-zinc-900' : 'text-zinc-600'}"
            @click=${() => this._handleSelect('es')}
          >
            Español
          </button>
          <button
            class="px-4 py-2 text-left text-sm hover:bg-zinc-100 ${current === 'ja' ? 'font-bold text-zinc-900' : 'text-zinc-600'}"
            @click=${() => this._handleSelect('ja')}
          >
            日本語
          </button>
        </div>
      </dropdown-menu>
    `;
  }
}
