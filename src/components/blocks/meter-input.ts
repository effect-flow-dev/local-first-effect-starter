// FILE: src/components/blocks/meter-input.ts
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/clientLog";

@customElement("meter-input")
export class MeterInput extends LitElement {
  @property({ type: String }) blockId = "";
  @property({ type: String }) label = "Meter";
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: String }) unit = "";

  // Local state to handle input lag and validation immediate feedback
  @state() private _localValue: number = 0;
  @state() private _error: string | null = null;

  private _debounceTimer?: ReturnType<typeof setTimeout>;

  // Use Light DOM for Tailwind
  protected override createRenderRoot() {
    return this;
  }

  // Sync props to local state when they change externally (e.g. from DB)
  // unless the user is actively typing (handled via focus check ideally, or just loose sync)
  override willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("value")) {
      this._localValue = this.value;
      this._validate();
    }
  }

  private _validate() {
    if (this._localValue < this.min) {
      this._error = `Below Minimum (${this.min})`;
    } else if (this._localValue > this.max) {
      this._error = `Exceeds Maximum (${this.max})`;
    } else {
      this._error = null;
    }
  }

  private _emitUpdate() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);

    this._debounceTimer = setTimeout(() => {
      runClientUnscoped(clientLog("debug", `[Meter] Emitting absolute value ${this._localValue}`));
      this.dispatchEvent(
        new CustomEvent("update-block", {
          bubbles: true,
          composed: true,
          detail: {
            blockId: this.blockId,
            fields: { value: this._localValue },
          },
        })
      );
    }, 500); // 500ms debounce
  }

  private _handleChange(delta: number) {
    // 1. Cancel any pending absolute updates (e.g. from typing) to avoid race conditions
    if (this._debounceTimer) clearTimeout(this._debounceTimer);

    // 2. Optimistic UI update
    // We update local state so the number changes instantly for the user
    this._localValue = Number((this._localValue + delta).toFixed(2));
    this._validate();
    this.requestUpdate(); 

    // 3. Dispatch Atomic Increment Event
    // Instead of setting the absolute value, we send the delta.
    // This allows the server to handle concurrent updates cleanly (e.g. +1 from User A, +1 from User B = +2).
    runClientUnscoped(clientLog("debug", `[Meter] Dispatching atomic increment: ${delta}`));
    
    this.dispatchEvent(
      new CustomEvent("increment-block", {
        bubbles: true,
        composed: true,
        detail: {
          blockId: this.blockId,
          key: "value",
          delta: delta,
        },
      })
    );
  }

  // ✅ FIX: Use arrow function property to bind 'this' correctly for event listeners
  private _handleInput = (e: Event) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(val)) {
      this._localValue = val;
      this._validate();
      this.requestUpdate();
      // Manual typing uses Last-Write-Wins (Absolute Set)
      this._emitUpdate();
    }
  };

  override render() {
    const isError = !!this._error;
    const borderColor = isError ? "border-red-500 bg-red-50" : "border-zinc-300 bg-white";
    const textColor = isError ? "text-red-900" : "text-zinc-900";

    return html`
      <div class="my-6 p-4 rounded-xl border-2 bg-zinc-50/50">
        <div class="flex justify-between items-end mb-2">
          <label class="text-sm font-bold uppercase tracking-wider text-zinc-500">${this.label}</label>
          ${this._error
            ? html`<span class="text-xs font-bold text-red-600 animate-pulse">${this._error}</span>`
            : html`<span class="text-xs text-zinc-400">Range: ${this.min} - ${this.max}</span>`}
        </div>

        <div class="flex items-stretch gap-2 h-16">
          <!-- Stepper Minus -->
          <button
            class="w-16 rounded-lg bg-zinc-200 hover:bg-zinc-300 active:bg-zinc-400 text-zinc-700 text-3xl font-bold flex items-center justify-center transition-colors touch-manipulation"
            @click=${() => this._handleChange(-1)}
            aria-label="Decrease"
          >
            −
          </button>

          <!-- Main Input Display -->
          <div class="flex-1 relative">
            <input
              type="number"
              class="w-full h-full text-center text-4xl font-mono font-bold rounded-lg border-2 focus:ring-4 focus:ring-blue-200 focus:outline-none transition-all ${borderColor} ${textColor}"
              .value=${String(this._localValue)}
              @input=${this._handleInput}
            />
            ${this.unit
              ? html`<span class="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 font-medium">${this.unit}</span>`
              : nothing}
          </div>

          <!-- Stepper Plus -->
          <button
            class="w-16 rounded-lg bg-blue-100 hover:bg-blue-200 active:bg-blue-300 text-blue-800 text-3xl font-bold flex items-center justify-center transition-colors touch-manipulation"
            @click=${() => this._handleChange(1)}
            aria-label="Increase"
          >
            +
          </button>
        </div>
        
        <!-- Visual Gauge Bar (Optional Polish) -->
        <div class="mt-3 h-2 w-full bg-zinc-200 rounded-full overflow-hidden">
          <div 
            class="h-full transition-all duration-300 ${isError ? 'bg-red-500' : 'bg-blue-500'}"
            style="width: ${Math.min(100, Math.max(0, ((this._localValue - this.min) / (this.max - this.min)) * 100))}%"
          ></div>
        </div>
      </div>
    `;
  }
}
