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
  @property({ type: String }) validationStatus = ""; 

  @state() private _localValue: number = 0;
  @state() private _error: string | null = null;

  private _debounceTimer?: ReturnType<typeof setTimeout>;
  private _debounceBaseline: number | null = null; // Tracks value at start of typing burst

  protected override createRenderRoot() {
    return this;
  }

  override willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("value")) {
      // Only sync from props if we are NOT currently typing (debouncing)
      if (this._debounceBaseline === null) {
        this._localValue = this.value;
        this._validate();
      }
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

  private _handleChange(delta: number) {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    // If we interrupt a typing session with a button click, flush pending?
    // For simplicity, button clicks are immediate atomic ops.
    this._debounceBaseline = null; 
    
    // Avoid floating point precision errors
    const nextVal = this._localValue + delta;
    this._localValue = Math.round(nextVal * 100) / 100;
    
    this._validate();
    this.requestUpdate(); 

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

  private _handleInput = (e: Event) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(val)) {
      // 1. Capture Baseline on first keystroke of a burst
      if (this._debounceBaseline === null) {
        this._debounceBaseline = this._localValue;
      }

      // 2. Update Local State (Immediate UI Feedback)
      this._localValue = val;
      this._validate();
      this.requestUpdate();
      
      // 3. Debounce the Atomic Commit
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      
      this._debounceTimer = setTimeout(() => {
        // Calculate the total change since the start of this typing burst
        const baseline = this._debounceBaseline ?? this._localValue;
        const totalDelta = this._localValue - baseline;

        if (totalDelta !== 0) {
            runClientUnscoped(clientLog("debug", `[Meter] Emitting atomic input delta: ${totalDelta} (from ${baseline} to ${this._localValue})`));
            
            this.dispatchEvent(
                new CustomEvent("increment-block", {
                    bubbles: true,
                    composed: true,
                    detail: { 
                        blockId: this.blockId, 
                        key: "value", 
                        delta: totalDelta 
                    },
                })
            );
        }
        
        // Reset baseline to allow new syncs/typing bursts
        this._debounceBaseline = null;
      }, 500);
    }
  };

  override render() {
    const isError = !!this._error || this.validationStatus === 'warning';
    
    const borderColor = isError 
        ? (this._error ? "border-red-500 bg-red-50" : "border-amber-400 bg-amber-50")
        : "border-zinc-300 bg-white";
        
    const textColor = isError 
        ? (this._error ? "text-red-900" : "text-amber-900")
        : "text-zinc-900";

    return html`
      <div class="my-6 p-4 rounded-xl border-2 transition-colors duration-300 ${borderColor}">
        <div class="flex justify-between items-end mb-2">
          <label class="text-sm font-bold uppercase tracking-wider text-zinc-500">${this.label}</label>
          <div class="flex flex-col items-end">
             ${this._error
                ? html`<span class="text-xs font-bold text-red-600 animate-pulse">${this._error}</span>`
                : html`<span class="text-xs text-zinc-400">Range: ${this.min} - ${this.max}</span>`
             }
             ${this.validationStatus === 'warning' && !this._error 
                ? html`<span class="text-xs font-bold text-amber-600">⚠ Needs Review</span>` 
                : nothing
             }
          </div>
        </div>

        <div class="flex items-stretch gap-2 h-16">
          <button
            class="w-16 rounded-lg bg-zinc-200 hover:bg-zinc-300 active:bg-zinc-400 text-zinc-700 text-3xl font-bold flex items-center justify-center transition-colors touch-manipulation"
            @click=${() => this._handleChange(-1)}
            aria-label="Decrease"
          >
            −
          </button>

          <div class="flex-1 relative">
            <input
              type="number"
              class="w-full h-full text-center text-4xl font-mono font-bold rounded-lg border-2 focus:ring-4 focus:ring-blue-200 focus:outline-none transition-all bg-transparent border-transparent ${textColor}"
              .value=${String(this._localValue)}
              @input=${this._handleInput}
            />
            ${this.unit
              ? html`<span class="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 font-medium">${this.unit}</span>`
              : nothing}
          </div>

          <button
            class="w-16 rounded-lg bg-blue-100 hover:bg-blue-200 active:bg-blue-300 text-blue-800 text-3xl font-bold flex items-center justify-center transition-colors touch-manipulation"
            @click=${() => this._handleChange(1)}
            aria-label="Increase"
          >
            +
          </button>
        </div>
        
        <div class="mt-3 h-2 w-full bg-zinc-200 rounded-full overflow-hidden">
          <div 
            class="h-full transition-all duration-300 ${this._error ? 'bg-red-500' : (this.validationStatus === 'warning' ? 'bg-amber-500' : 'bg-blue-500')}"
            style="width: ${Math.min(100, Math.max(0, ((this._localValue - this.min) / (this.max - this.min)) * 100))}%"
          ></div>
        </div>
      </div>
    `;
  }
}
