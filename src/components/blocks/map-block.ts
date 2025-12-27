// FILE: src/components/blocks/map-block.ts
import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import L from "leaflet";
import "leaflet/dist/leaflet.css"; // Ensure Vite processes this
import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/clientLog";

// Fix for default Leaflet marker icons in bundlers (Vite/Webpack)
// Without this, the URL resolution often fails for the marker images.
// @ts-expect-error - Leaflet internals
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

@customElement("map-block")
export class MapBlock extends LitElement {
  @property({ type: String }) blockId = "";
  @property({ type: Number }) latitude = 51.505;
  @property({ type: Number }) longitude = -0.09;
  @property({ type: Number }) zoom = 13;
  @property({ type: Boolean }) interactive = false; // Read-only vs Editable mode

  private map: L.Map | null = null;
  private marker: L.Marker | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Use Light DOM to play nicely with Leaflet's DOM manipulation and CSS
  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    // We need to wait for the render to ensure the container div exists
    // Lit's firstUpdated is safer, but we add a safeguard here.
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  protected override firstUpdated() {
    this._initMap();
  }

  // Handle prop changes (e.g. incoming sync from another device)
  override updated(changedProperties: Map<string, unknown>) {
    if (!this.map) return;

    const latChanged = changedProperties.has("latitude");
    const lonChanged = changedProperties.has("longitude");
    const zoomChanged = changedProperties.has("zoom");

    if (latChanged || lonChanged || zoomChanged) {
      // Avoid flyTo if the change originated from THIS component's drag event (prevent jitter)
      // We check if the map center is significantly different from props
      const currentCenter = this.map.getCenter();
      const dist = currentCenter.distanceTo([this.latitude, this.longitude]);
      
      // Only fly if distance > 10 meters to avoid feedback loops
      if (dist > 10) {
        this.map.setView([this.latitude, this.longitude], this.zoom);
      }

      if (this.marker) {
        this.marker.setLatLng([this.latitude, this.longitude]);
      }
    }
    
    // Handle resize issues (common in tabs/dynamic layouts)
    this.map.invalidateSize();
  }

  private _initMap() {
    const container = this.querySelector<HTMLElement>(".map-container");
    if (!container) return;

    // 1. Initialize Map
    this.map = L.map(container, {
      center: [this.latitude, this.longitude],
      zoom: this.zoom,
      scrollWheelZoom: false, // Prevent accidental scrolling while reading note
      dragging: true, // Allow panning
    });

    // 2. Add Tile Layer (Stadia / OSM)
    // We use OpenStreetMap here for zero-config, but this URL matches the 
    // SW cache strategy defined in Phase 1.
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.map);

    // 3. Add Marker
    this.marker = L.marker([this.latitude, this.longitude], {
      draggable: true, 
    }).addTo(this.map);

    // 4. Handle Marker Drag (Update Coords)
    this.marker.on("dragend", (event) => {
      const marker = event.target as L.Marker;
      const position = marker.getLatLng();
      
      this._dispatchUpdate({
        latitude: position.lat,
        longitude: position.lng,
      });
    });

    // 5. Handle Zoom Change
    this.map.on("zoomend", () => {
      if (!this.map) return;
      this._dispatchUpdate({
        zoom: this.map.getZoom(),
      });
    });

    // 6. Resize Observer to fix "grey tiles" if container size changes
    this.resizeObserver = new ResizeObserver(() => {
      this.map?.invalidateSize();
    });
    this.resizeObserver.observe(container);
  }

  private _dispatchUpdate(fields: Record<string, unknown>) {
    // Only dispatch if blockId is present (persisted block)
    if (!this.blockId) return;

    runClientUnscoped(clientLog("debug", `[MapBlock] Dispatching update`, fields));
    
    this.dispatchEvent(
      new CustomEvent("update-block", {
        bubbles: true,
        composed: true,
        detail: {
          blockId: this.blockId,
          fields,
        },
      })
    );
  }

  override render() {
    // Height needs to be explicit for Leaflet
    return html`
      <div class="my-4 rounded-lg overflow-hidden border border-zinc-300 shadow-sm bg-zinc-100">
        <div class="map-container" style="height: 300px; width: 100%; z-index: 0;"></div>
        <div class="px-3 py-2 bg-white text-xs text-zinc-500 border-t border-zinc-200 flex justify-between">
            <span>${this.latitude.toFixed(4)}, ${this.longitude.toFixed(4)}</span>
            <span>Zoom: ${this.zoom}</span>
        </div>
      </div>
    `;
  }
}
