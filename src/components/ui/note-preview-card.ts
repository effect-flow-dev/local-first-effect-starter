// FILE: src/components/ui/note-preview-card.ts
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("note-preview-card")
export class NotePreviewCard extends LitElement {
  // ✅ FIX: Added 'override' keyword since 'title' exists on HTMLElement
  @property({ type: String }) override title = "";
  
  @property({ type: String }) snippet = "";
  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  @property({ type: Boolean }) isLoading = false;

  static override styles = css`
    :host {
      position: fixed;
      z-index: 50;
      pointer-events: none; /* Let clicks pass through so we don't block interaction */
      transition: opacity 0.15s ease-in-out;
    }

    .card {
      background: white;
      border: 1px solid #e4e4e7; /* zinc-200 */
      border-radius: 8px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      padding: 12px;
      width: 280px;
      max-width: 90vw;
    }

    .title {
      font-weight: 600;
      font-size: 0.875rem; /* text-sm */
      color: #18181b; /* zinc-900 */
      margin-bottom: 4px;
    }

    .snippet {
      font-size: 0.75rem; /* text-xs */
      color: #71717a; /* zinc-500 */
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.4;
    }

    .loading {
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #a1a1aa;
      font-size: 0.75rem;
    }
  `;

  override render() {
    // Offset slightly so it doesn't cover the cursor/text directly
    const style = `left: ${this.x}px; top: ${this.y + 20}px;`;

    return html`
      <div class="card" style=${style}>
        <div class="title">${this.title}</div>
        ${this.isLoading
          ? html`<div class="loading">Loading preview...</div>`
          : html`<div class="snippet">${this.snippet || "No content."}</div>`}
      </div>
    `;
  }
}
