import * as THREE from 'three';
import { tileIndex, tileKey, chebyshevDistance } from '../core/geo.js';
import {
  buildingsMaterial,
  waterMaterial,
  landuseMaterial,
  roadsMaterial,
  railMaterial,
} from './materials.js';

const LAYER_MATERIALS = {
  buildings: buildingsMaterial,
  roads: roadsMaterial,
  water: waterMaterial,
  landuse: landuseMaterial,
  rail: railMaterial,
};

const MAX_INTEGRATIONS_PER_FRAME = 2;
const WORKER_COUNT = 3;

/**
 * Streams tile geometry in a radius around the player: fetches tile JSON,
 * builds geometry in a worker pool, integrates finished tiles onto the main
 * thread at a throttled rate (the actual hitch-avoidance mechanism), and
 * disposes tiles once they fall outside a hysteresis band.
 */
export class TileManager {
  constructor(scene, { tileSize, loadRadius, disposeRadius, tilesBaseUrl = './tiles', onTileLoaded, onTileUnloaded }) {
    this.scene = scene;
    this.tileSize = tileSize;
    this.loadRadius = loadRadius;
    this.disposeRadius = disposeRadius;
    this.tilesBaseUrl = tilesBaseUrl;
    this.onTileLoaded = onTileLoaded ?? (() => {});
    this.onTileUnloaded = onTileUnloaded ?? (() => {});

    this.manifest = null;
    this.loaded = new Map(); // key -> { group, meshes: {layerName: Mesh} }
    this.pending = new Set(); // keys currently fetching/building
    this.readyQueue = []; // closures awaiting throttled main-thread integration
    this.lastPlayerTileKey = null;
    this._centerTx = null;
    this._centerTz = null;

    this.workers = [];
    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(new URL('./TileBuilder.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => this._onWorkerMessage(e.data);
      worker.onerror = (e) => {
        console.error(`[TileManager] worker ${i} error:`, e.message, e);
      };
      worker.onmessageerror = (e) => {
        console.error(`[TileManager] worker ${i} message deserialization error:`, e);
      };
      this.workers.push(worker);
    }
    this._nextWorker = 0;
  }

  async init() {
    const res = await fetch(`${this.tilesBaseUrl}/manifest.json`);
    this.manifest = await res.json();
  }

  /** Call once per frame with the player's world-space position. */
  update(playerX, playerZ) {
    // The render loop starts before init()'s manifest fetch resolves; a
    // reconcile this early would (correctly) no-op on an empty manifest,
    // but its lastPlayerTileKey write would then make the real post-init
    // call at the same position look like a no-move and get skipped too.
    if (this.manifest == null) return;

    const { tx, tz } = tileIndex(playerX, playerZ, this.tileSize);
    const playerKey = tileKey(tx, tz);

    if (playerKey !== this.lastPlayerTileKey) {
      this.lastPlayerTileKey = playerKey;
      this._reconcile(tx, tz);
    }

    this._drainReadyQueue();
  }

  get loadedTileCount() {
    return this.loaded.size;
  }

  _hasData(key) {
    return this.manifest != null && Object.prototype.hasOwnProperty.call(this.manifest.tiles, key);
  }

  _pickWorker() {
    const worker = this.workers[this._nextWorker];
    this._nextWorker = (this._nextWorker + 1) % this.workers.length;
    return worker;
  }

  _reconcile(centerTx, centerTz) {
    this._centerTx = centerTx;
    this._centerTz = centerTz;

    for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
      for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
        const tx = centerTx + dx;
        const tz = centerTz + dz;
        const key = tileKey(tx, tz);
        if (!this._hasData(key)) continue; // rural/empty tile — manifest skips these
        if (this.loaded.has(key) || this.pending.has(key)) continue;
        this._requestTile(key);
      }
    }

    for (const [key, entry] of this.loaded) {
      const [ltx, ltz] = key.split('_').map(Number);
      if (chebyshevDistance(ltx, ltz, centerTx, centerTz) > this.disposeRadius) {
        this._disposeTile(key, entry);
      }
    }
  }

  async _requestTile(key) {
    this.pending.add(key);
    try {
      const res = await fetch(`${this.tilesBaseUrl}/${key}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching tile ${key}`);
      const tile = await res.json();
      this._pickWorker().postMessage({ type: 'build', key, tile });
    } catch (err) {
      console.error(`[TileManager] failed to load tile ${key}:`, err);
      this.pending.delete(key);
    }
  }

  _onWorkerMessage(data) {
    if (data.type !== 'built') return;
    const { key, layers } = data;
    if (!this.pending.has(key)) return; // superseded (e.g. disposed already)

    this.readyQueue.push(() => {
      this.pending.delete(key);
      if (this.loaded.has(key)) return;

      // The player may have moved on while this tile was in flight —
      // integrating it only to dispose it next reconcile would waste a
      // frame's integration budget. Drop it if it's fallen outside the
      // hysteresis band entirely.
      const [ltx, ltz] = key.split('_').map(Number);
      if (this._centerTx != null && chebyshevDistance(ltx, ltz, this._centerTx, this._centerTz) > this.disposeRadius) {
        return;
      }

      this._integrateTile(key, layers);
    });
  }

  _drainReadyQueue() {
    let n = MAX_INTEGRATIONS_PER_FRAME;
    while (n-- > 0 && this.readyQueue.length > 0) {
      this.readyQueue.shift()();
    }
  }

  _integrateTile(key, layers) {
    const group = new THREE.Group();
    group.name = `tile:${key}`;
    const meshes = {};

    for (const [name, layer] of Object.entries(layers)) {
      if (!layer) continue;
      const mesh = new THREE.Mesh(this._geometryFromLayer(layer), LAYER_MATERIALS[name]);
      mesh.name = `${key}:${name}`;
      group.add(mesh);
      meshes[name] = mesh;
    }

    this.scene.add(group);
    this.loaded.set(key, { group, meshes });
    this.onTileLoaded(key, meshes);
  }

  _geometryFromLayer(layer) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(layer.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(layer.normal, 3));
    if (layer.color) geometry.setAttribute('color', new THREE.BufferAttribute(layer.color, 3));
    geometry.setIndex(new THREE.BufferAttribute(layer.index, 1));
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(...layer.boundingBox.min),
      new THREE.Vector3(...layer.boundingBox.max)
    );
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(...layer.boundingSphere.center),
      layer.boundingSphere.radius
    );
    return geometry;
  }

  _disposeTile(key, entry) {
    this.onTileUnloaded(key, entry.meshes);
    this.scene.remove(entry.group);
    for (const mesh of Object.values(entry.meshes)) {
      mesh.geometry.dispose(); // never dispose the shared materials
    }
    this.loaded.delete(key);
  }

  /** Disposes every loaded tile and terminates the worker pool. */
  dispose() {
    for (const [key, entry] of [...this.loaded]) this._disposeTile(key, entry);
    for (const worker of this.workers) worker.terminate();
  }
}
