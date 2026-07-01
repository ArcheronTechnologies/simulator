import { deserializeShard } from '../../scripts/lib/population_shard.mjs';

// Loads and holds citizen records, sharded by home tile exactly like the world
// tiles. Only tiles near the player are ever fetched/resident; shards are
// dropped when their tile unloads, so memory stays bounded to the ~25 loaded
// tiles regardless of the ~120k total population. Pure data — no THREE.
export class PopulationStore {
  constructor({ baseUrl = './population', tileSize = 500 } = {}) {
    this.baseUrl = baseUrl;
    this.tileSize = tileSize;
    this.manifest = null;
    this.tiles = new Map(); // homeTileKey -> citizen record[] (loaded)
    this._pending = new Set(); // homeTileKeys currently fetching
  }

  async init() {
    const res = await fetch(`${this.baseUrl}/manifest.json`);
    this.manifest = await res.json();
  }

  /** Does the manifest list citizens homed in this tile? */
  hasTile(key) {
    return this.manifest != null && this.manifest.tiles[key] != null;
  }

  isLoaded(key) {
    return this.tiles.has(key);
  }

  /**
   * Fetch + hold the citizens homed in a tile (idempotent, ignores tiles with
   * no population). Returns the record array (possibly empty).
   */
  async ensureTileLoaded(key) {
    if (this.tiles.has(key)) return this.tiles.get(key);
    if (!this.hasTile(key) || this._pending.has(key)) return null;
    this._pending.add(key);
    try {
      const res = await fetch(`${this.baseUrl}/${key}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for population ${key}`);
      const shard = await res.json();
      if (this.tiles.has(key)) return this.tiles.get(key); // raced
      const records = deserializeShard(shard);
      // Derive the (cheap, un-stored) work tile once for the byWorkTile logic.
      for (const r of records) r.workTile = this._tileKeyFor(r.workXZ[0], r.workXZ[1]);
      this.tiles.set(key, records);
      return records;
    } catch (err) {
      console.error(`[PopulationStore] failed to load ${key}:`, err);
      return null;
    } finally {
      this._pending.delete(key);
    }
  }

  /** Drop a tile's citizens (called when the world tile unloads). */
  unloadTile(key) {
    this.tiles.delete(key);
  }

  getCitizens(key) {
    return this.tiles.get(key) ?? [];
  }

  get loadedTileCount() {
    return this.tiles.size;
  }

  _tileKeyFor(x, z) {
    return `${Math.floor(x / this.tileSize)}_${Math.floor(z / this.tileSize)}`;
  }
}
