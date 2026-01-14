// FILE: src/components/blocks/map-block.ts
import { LitElement, html, nothing } from "lit";
import { customElement, property }  from "lit/decorators.js";
import L from "leaflet";
import "leaflet/dist/leaflet.css"; 
import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/clientLog";
import "../ui/entity-selector";

// Fix for default Leaflet marker icons in bundlers
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
  @property({ type: Boolean }) interactive = false; 

  // ✅ NEW PROPS for Context
  @property({ type: String }) entityId: string | null = null;
  @property({ type: String }) locationSource: "gps" | "manual" | "entity_fixed" = "manual";
  @property({ type: Number }) locationAccuracy: number | null = null;

  private map: L.Map | null = null;
  private marker: L.Marker | null = null;
  private circle: L.Circle | null = null;
  private resizeObserver: ResizeObserver | null = null;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
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

  override updated(changedProperties: Map<string, unknown>) {
    if (!this.map) return;

    const latChanged = changedProperties.has("latitude");
    const lonChanged = changedProperties.has("longitude");
    const zoomChanged = changedProperties.has("zoom");
    const sourceChanged = changedProperties.has("locationSource");
    const accChanged = changedProperties.has("locationAccuracy");

    if (latChanged || lonChanged || zoomChanged || sourceChanged) {
      const currentCenter = this.map.getCenter();
      const dist = currentCenter.distanceTo([this.latitude, this.longitude]);
      
      if (dist > 10) {
        this.map.setView([this.latitude, this.longitude], this.zoom);
      }

      if (this.marker) {
        this.marker.setLatLng([this.latitude, this.longitude]);
        this._updateMarkerStyle();
      }
    }

    if (accChanged || latChanged || lonChanged) {
        this._updateAccuracyCircle();
    }
    
    this.map.invalidateSize();
  }

  private _initMap() {
    const container = this.querySelector<HTMLElement>(".map-container");
    if (!container) return;

    this.map = L.map(container, {
      center: [this.latitude, this.longitude],
      zoom: this.zoom,
      scrollWheelZoom: false,
      dragging: !this._isLocked(), // Disable drag if entity locked
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.map);

    this.marker = L.marker([this.latitude, this.longitude], {
      draggable: !this._isLocked(), 
    }).addTo(this.map);

    this._updateMarkerStyle();
    this._updateAccuracyCircle();

    this.marker.on("dragend", (event) => {
      if (this._isLocked()) return; // Should not happen if draggable is false, but safety check

      const marker = event.target as L.Marker;
      const position = marker.getLatLng();
      
      this._dispatchUpdate({
        latitude: position.lat,
        longitude: position.lng,
        locationSource: "manual", // Dragging always reverts to manual
        entityId: null, // Clear entity link on manual move
        locationAccuracy: null // Manual has unknown accuracy
      });
    });

    this.map.on("zoomend", () => {
      if (!this.map) return;
      this._dispatchUpdate({
        zoom: this.map.getZoom(),
      });
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.map?.invalidateSize();
    });
    this.resizeObserver.observe(container);
  }

  private _isLocked() {
      return this.locationSource === 'entity_fixed';
  }

  private _updateMarkerStyle() {
      if (!this.marker || !this.marker.getElement()) return;
      
      const icon = this.marker.getElement();
      if (!icon) return;

      // CSS Filters for Marker Color
      // Default (Blue) = GPS / Default
      // Manual = Grey
      // Entity = Green
      
      if (this.locationSource === 'manual') {
          icon.style.filter = "grayscale(100%)";
      } else if (this.locationSource === 'entity_fixed') {
          icon.style.filter = "hue-rotate(260deg) saturate(200%)"; // Shift blue to green/purple high vis
      } else if (this.locationSource === 'gps') {
          icon.style.filter = "none"; // Standard Leaflet Blue
      }
      
      // Toggle draggable
      if (this.marker.dragging) {
          if (this._isLocked()) this.marker.dragging.disable();
          else this.marker.dragging.enable();
      }
  }

  private _updateAccuracyCircle() {
      if (!this.map) return;

      if (this.circle) {
          this.circle.remove();
          this.circle = null;
      }

      if (this.locationSource === 'gps' && this.locationAccuracy && this.locationAccuracy > 0) {
          this.circle = L.circle([this.latitude, this.longitude], {
              radius: this.locationAccuracy,
              color: '#3b82f6',
              fillColor: '#3b82f6',
              fillOpacity: 0.1,
              weight: 1
          }).addTo(this.map);
      }
  }

  private _handleEntityChange = (e: CustomEvent<string | null>) => {
      const entityId = e.detail;
      if (entityId) {
          // If selecting an entity, we tell the parent to update.
          // The backend will enforce the coordinates.
          // We optimistically update source here for UI feedback, but coord snap happens via sync/backend return.
          this._dispatchUpdate({
              entityId,
              // Backend will override lat/long/source, but we send the ID to trigger that logic.
          });
      } else {
          // Clearing entity -> Revert to Manual mode at current location
          this._dispatchUpdate({
              entityId: null,
              locationSource: "manual",
              locationAccuracy: null
          });
      }
  };

  private _dispatchUpdate(fields: Record<string, unknown>) {
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

  private _getSourceBadge() {
      switch (this.locationSource) {
          case 'entity_fixed':
              return html`<span class="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                <svg class="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                Entity Linked
              </span>`;
          case 'gps':
              return html`<span class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                <svg class="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                GPS ${this.locationAccuracy ? `(±${Math.round(this.locationAccuracy)}m)` : ''}
              </span>`;
          case 'manual':
          default:
              return html`<span class="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-800">Manual</span>`;
      }
  }

  override render() {
    return html`
      <div class="my-4 rounded-lg overflow-hidden border border-zinc-300 shadow-sm bg-zinc-50">
        <div class="map-container relative" style="height: 300px; width: 100%; z-index: 0;">
            ${this.locationSource === 'entity_fixed' 
                ? html`<div class="absolute top-2 right-2 z-[400] bg-white/90 backdrop-blur px-2 py-1 rounded text-xs font-bold text-zinc-600 shadow-sm border border-zinc-200 pointer-events-none">
                    LOCKED
                  </div>` 
                : nothing
            }
        </div>
        
        <div class="flex flex-col gap-2 p-3 bg-white border-t border-zinc-200">
            <!-- Context Header -->
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    ${this._getSourceBadge()}
                    <span class="text-xs text-zinc-500 font-mono">${this.latitude.toFixed(5)}, ${this.longitude.toFixed(5)}</span>
                </div>
                <div class="text-xs text-zinc-400">Zoom: ${this.zoom}</div>
            </div>

            <!-- Entity Linker -->
            <div class="flex items-center gap-2 pt-2 border-t border-zinc-100">
                <span class="text-xs font-medium text-zinc-600 shrink-0">Link Asset:</span>
                <div class="flex-1">
                    <entity-selector
                        .value=${this.entityId || ""}
                        @change=${this._handleEntityChange}
                    ></entity-selector>
                </div>
            </div>
        </div>
      </div>
    `;
  }
}
