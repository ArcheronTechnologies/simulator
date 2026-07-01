import { projection } from '../config.js';

const INFO_UPDATE_INTERVAL_MS = 300; // street/coords don't need per-frame precision
const FPS_WINDOW = 30; // frames, smooths the readout

const COMPASS_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compassHeadingDeg(cameraYaw) {
  // Matches the app-wide convention (-Z = geographic north, +X = east):
  // forward = (-sin(yaw), 0, -cos(yaw)), so heading = -yaw in degrees.
  return (((-cameraYaw * 180) / Math.PI) % 360 + 360) % 360;
}

/** Always-on overlay: controls help, position/street/compass, debug stats. */
export class Hud {
  constructor(renderer) {
    this.renderer = renderer;
    this._lastInfoUpdate = 0;
    this._frameDeltas = [];
    this._buildDom();
  }

  _buildDom() {
    const baseStyle = `
      position: fixed; z-index: 10; pointer-events: none;
      color: #e8e4da; text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      background: rgba(10,12,14,0.4); border-radius: 6px;
    `;

    this.controlsEl = document.createElement('div');
    this.controlsEl.style.cssText = `${baseStyle} left: 12px; bottom: 12px; padding: 8px 10px; font: 12px/1.6 system-ui, sans-serif;`;
    this.controlsEl.innerHTML =
      '<div><b>WASD</b> move &middot; <b>Shift</b> run &middot; <b>Space</b> jump</div>' +
      '<div>Click to lock mouse &middot; move mouse to look around</div>';

    this.infoEl = document.createElement('div');
    this.infoEl.style.cssText = `${baseStyle} right: 12px; top: 12px; padding: 8px 10px; font: 12px/1.6 system-ui, sans-serif; text-align: right; min-width: 170px;`;

    this.statsEl = document.createElement('div');
    this.statsEl.style.cssText = `${baseStyle} left: 12px; top: 12px; padding: 6px 8px; font: 11px/1.5 monospace; white-space: pre-line; color: #9fe89f;`;

    document.body.append(this.controlsEl, this.infoEl, this.statsEl);
  }

  /** @param {{position: THREE.Vector3, cameraYaw: number, tileManager: object}} state */
  update(delta, state) {
    this._updateStats(delta, state.tileManager);
    this._updateInfoThrottled(state);
  }

  _updateStats(delta, tileManager) {
    this._frameDeltas.push(delta);
    if (this._frameDeltas.length > FPS_WINDOW) this._frameDeltas.shift();
    const avgDelta = this._frameDeltas.reduce((a, b) => a + b, 0) / this._frameDeltas.length;
    const fps = avgDelta > 0 ? Math.round(1 / avgDelta) : 0;

    const info = this.renderer.info;
    this.statsEl.textContent =
      `${fps} fps\n` +
      `${info.render.calls} draw calls\n` +
      `${(info.render.triangles / 1000).toFixed(1)}k tris\n` +
      `${info.memory.geometries} geom / ${info.memory.textures} tex\n` +
      `${tileManager.loadedTileCount} tiles loaded`;
  }

  _updateInfoThrottled({ position, cameraYaw, tileManager }) {
    const now = performance.now();
    if (now - this._lastInfoUpdate < INFO_UPDATE_INTERVAL_MS) return;
    this._lastInfoUpdate = now;

    const latlon = projection.unproject(position.x, position.z);
    const heading = compassHeadingDeg(cameraYaw);
    const compass = COMPASS_LABELS[Math.round(heading / 45) % 8];
    const street = tileManager.findNearestRoadName(position.x, position.z);

    this.infoEl.innerHTML =
      `<div style="font-size: 13px; margin-bottom: 2px;">${street ?? 'Lund'}</div>` +
      `<div>${compass} ${heading.toFixed(0)}&deg;</div>` +
      `<div>${latlon.lat.toFixed(5)}, ${latlon.lon.toFixed(5)}</div>`;
  }
}
