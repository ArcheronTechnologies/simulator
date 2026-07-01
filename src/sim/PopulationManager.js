import { scheduleState, AtWork, Leisure, Commuting } from '../../scripts/lib/schedule.mjs';
import { nearestPointOnPolylines } from '../../scripts/lib/spatial.mjs';
import { unitHash } from '../../scripts/lib/hash.mjs';

// Orchestrates the citizen simulation with tile-driven agent LOD. The ~120k
// population is dormant; only citizens homed in loaded tiles are candidates,
// and only the nearest ~capacity within the activation radius get pooled bodies.
// Per-frame cost scales with the visible crowd, not the total population.
const RECONCILE_TICK = 10; // frames between body reconciliation (bodies interpolate between)
// Place a citizen on the nearest road within this of their anchor. Generous:
// a big building's centroid can sit deep in a block, and standing on a street
// 80m away reads far better than embedded in the footprint. Only genuinely
// road-less spots (fields, car parks) fall back to the raw anchor.
const SNAP_MAX_M = 130;

export class PopulationManager {
  constructor({ store, pool, clock, tileManager, activationRadius, releaseRadius, capacity, tileSize = 500 }) {
    this.store = store;
    this.pool = pool;
    this.clock = clock;
    this.tileManager = tileManager;
    this.activationRadius = activationRadius;
    this.releaseRadius = releaseRadius;
    this.capacity = capacity;
    this.tileSize = tileSize;

    this._activeTiles = new Set(); // home-tile keys with world geometry loaded
    this._frame = 0;
    // Activity histogram of nearby citizens from the last reconcile (debug/HUD).
    this._activityCounts = { AtHome: 0, AtWork: 0, Commuting: 0, Leisure: 0 };
  }

  /** Wire to TileManager.onTileLoaded. Async-loads the shard, then activates. */
  onTileLoaded(key) {
    this.store.ensureTileLoaded(key).then(() => {
      if (this.store.hasTile(key)) this._activeTiles.add(key);
    });
  }

  /** Wire to TileManager.onTileUnloaded. Releases bodies + drops the shard. */
  onTileUnloaded(key) {
    if (!this._activeTiles.has(key) && !this.store.isLoaded(key)) return;
    this._activeTiles.delete(key);
    for (const rec of this.store.getCitizens(key)) {
      if (this.pool.isActive(rec.id)) this.pool.release(rec.id);
    }
    this.store.unloadTile(key);
  }

  update(delta, playerX, playerZ) {
    this._frame++;
    if (this._frame % RECONCILE_TICK === 0) this._reconcile(playerX, playerZ);
    this.pool.update(delta);
  }

  get renderedCount() {
    return this.pool.activeCount;
  }

  _reconcile(px, pz) {
    const t = this.clock.minutesOfDay;
    const day = this.clock.day;
    const rAct2 = this.activationRadius * this.activationRadius;
    const rRel2 = this.releaseRadius * this.releaseRadius;
    // Only tiles whose area can reach the player matter; skip far loaded tiles.
    const tileReach = this.releaseRadius + this.tileSize;

    const counts = { AtHome: 0, AtWork: 0, Commuting: 0, Leisure: 0 };
    const inRange = [];
    for (const key of this._activeTiles) {
      const [tx, tz] = key.split('_').map(Number);
      const cx = (tx + 0.5) * this.tileSize;
      const cz = (tz + 0.5) * this.tileSize;
      if (Math.abs(cx - px) > tileReach || Math.abs(cz - pz) > tileReach) continue;

      for (const rec of this.store.getCitizens(key)) {
        const s = scheduleState(rec, t, day);
        counts[s.activity]++;
        // Only render citizens who are OUTDOORS. AtHome/AtWork means indoors
        // (asleep, working) — invisible. This is what empties the streets at
        // 3am and fills them during commutes/leisure.
        if (s.activity !== Commuting && s.activity !== Leisure) continue;
        const anchor = this._anchorPos(rec, s);
        const dx = anchor[0] - px;
        const dz = anchor[1] - pz;
        const dsq = dx * dx + dz * dz;
        if (dsq <= rRel2) inRange.push({ rec, s, ax: anchor[0], az: anchor[1], dsq });
      }
    }

    this._activityCounts = counts;
    inRange.sort((a, b) => a.dsq - b.dsq);
    const keep = inRange.slice(0, this.capacity);
    const keepIds = new Set(keep.map((k) => k.rec.id));

    // Release any active body whose citizen fell outside the keep set
    // (beyond the release radius, or bumped past the nearest-capacity cap).
    for (const id of [...this.pool.active.keys()]) {
      if (!keepIds.has(id)) this.pool.release(id);
    }

    // Acquire/position the kept citizens, nearest first. New bodies are only
    // acquired within the inner activation radius (hysteresis vs the release
    // radius keeps bodies from flickering at the boundary).
    for (const k of keep) {
      let body = this.pool.active.get(k.rec.id);
      if (!body) {
        if (k.dsq > rAct2) continue;
        body = this.pool.acquire(k.rec.id);
        if (!body) break; // pool full; remaining are farther (sorted), so stop
      }
      this._placeBody(body, k);
    }
  }

  _anchorPos(rec, s) {
    if (s.activity === AtWork) return rec.workXZ;
    if (s.activity === Leisure) return rec.leisureXZ;
    if (s.activity === Commuting) {
      // v1: hold at the departure anchor (RoadFollower will animate the walk).
      return s.from === 'work' ? rec.workXZ : s.from === 'leisure' ? rec.leisureXZ : rec.homeXZ;
    }
    return rec.homeXZ; // AtHome
  }

  _placeBody(body, k) {
    // Snap onto the nearest street so citizens stand at their doorstep, not
    // embedded in the building footprint.
    const roads = this.tileManager.getNearbyRoads(k.ax, k.az);
    let x = k.ax;
    let z = k.az;
    if (roads.length) {
      const snap = nearestPointOnPolylines(roads, k.ax, k.az);
      if (snap && snap.dist <= SNAP_MAX_M) { x = snap.x; z = snap.z; }
    }
    const yaw = unitHash(k.rec.id, 'yaw') * Math.PI * 2;
    body.setPositionYaw(x, 0, z, yaw);
    body.setState('idle');
  }
}
