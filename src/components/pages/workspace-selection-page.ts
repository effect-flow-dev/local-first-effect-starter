// FILE: src/components/pages/workspace-selection-page.ts
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../../lib/client/api";
import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/clientLog";

interface Membership {
  id: string; // Tenant ID
  name: string;
  subdomain: string;
  role: string;
}

@customElement("workspace-selection-page")
export class WorkspaceSelectionPage extends LitElement {
  @state() private memberships: Membership[] = [];
  @state() private loading = true;
  @state() private error: string | null = null;

  // ✅ FIX: Use Lit's static styles instead of importing a non-existent CSS module
  static override styles = css`
    :host { display: block; font-family: 'Inter', sans-serif; }
    .container { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f4f4f5; }
    .card { background: white; padding: 2rem; border-radius: 0.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); width: 100%; max-width: 480px; }
    .title { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; color: #18181b; }
    .subtitle { color: #71717a; margin-bottom: 1.5rem; }
    .list { display: flex; flex-direction: column; gap: 0.75rem; }
    .item { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 1rem; border: 1px solid #e4e4e7; border-radius: 0.375rem; background: white; cursor: pointer; transition: all 0.2s; text-align: left; }
    .item:hover { border-color: #a1a1aa; background: #fafafa; }
    .info { display: flex; flex-direction: column; }
    .name { font-weight: 600; color: #18181b; }
    .url { font-size: 0.875rem; color: #a1a1aa; }
    .badge { font-size: 0.75rem; padding: 0.25rem 0.5rem; background: #f4f4f5; border-radius: 9999px; color: #52525b; font-weight: 500; }
    .error { color: #ef4444; }
  `;

  override connectedCallback() {
    super.connectedCallback();
    // ✅ FIX: Explicitly ignore floating promise from async method
    void this._fetchMemberships();
  }

  private async _fetchMemberships() {
    this.loading = true;
    const token = localStorage.getItem("jwt");
    if (!token) {
        this.error = "Not authenticated";
        this.loading = false;
        return;
    }

    try {
        const response = await api.api.auth.memberships.get({
            headers: { Authorization: `Bearer ${token}` }
        });

        const { data, error } = response;

        if (error) {
            this.error = "Failed to load workspaces";
        } else if (data && 'memberships' in data) {
            // ✅ FIX: Type guard / assertion for memberships existence
            this.memberships = (data as { memberships: Membership[] }).memberships;
        }
    } catch {
        // ✅ FIX: Removed unused variable '_e'
        this.error = "Network error";
    } finally {
        this.loading = false;
    }
  }

  private _handleSelect(subdomain: string) {
    const rootDomain = import.meta.env.VITE_ROOT_DOMAIN || "localhost";
    const port = window.location.port ? `:${window.location.port}` : "";
    const protocol = window.location.protocol;
    
    // Redirect to subdomain with token handoff
    const targetUrl = `${protocol}//${subdomain}.${rootDomain}${port}/?t=${localStorage.getItem("jwt")}`;
    
    runClientUnscoped(clientLog("info", `Redirecting to workspace: ${subdomain}`));
    window.location.href = targetUrl;
  }

  override render() {
    if (this.loading) {
        return html`<div class="container"><p>Loading workspaces...</p></div>`;
    }

    if (this.error) {
        return html`<div class="container error"><p>${this.error}</p></div>`;
    }

    return html`
      <div class="container">
        <div class="card">
            <h1 class="title">Select Workspace</h1>
            <p class="subtitle">You are a member of ${this.memberships.length} workspaces.</p>
            
            <div class="list">
                ${this.memberships.map(m => html`
                    <button class="item" @click=${() => this._handleSelect(m.subdomain)}>
                        <div class="info">
                            <span class="name">${m.name}</span>
                            <span class="url">${m.subdomain}</span>
                        </div>
                        <span class="role badge">${m.role}</span>
                    </button>
                `)}
            </div>
            
            ${this.memberships.length === 0 ? html`
                <div class="empty">No workspaces found. Contact your administrator.</div>
            ` : nothing}
        </div>
      </div>
    `;
  }
}
