import { scheduleState, Leisure, Commuting } from '../../scripts/lib/schedule.mjs';
import { nearestPointOnPolylines } from '../../scripts/lib/spatial.mjs';
import { stepAlongRoads } from './RoadFollower.js';
import { unitHash } from '../../scripts/lib/hash.mjs';

// Orchestrates the citizen simulation with tile-driven agent LOD. The ~120k
// population is dormant; only citizens homed in loaded tiles are candidates,
// and only the nearest ~capacity within the activation radius get pooled bodies.
// Per-frame cost scales with the visible crowd, not the total population.
const RECONCILE_TICK = 10; // frames between acquire/release reconciliation
// Place a citizen on the nearest road within this of their anchor. Generous:
// a big building's centroid can sit deep in a block, and standing on a street
// 80m away reads far better than embedded in the footprint. Only genuinely
// road-less spots (fields, car parks) fall back to the raw anchor.
const SNAP_MAX_M = 130;
const WALK_SPEED_MPS = 1.35; // leisurely pedestrian pace
const ARRIVE_DIST_M = 4; // within this of the destination, stand and idle

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
    this._advanceBodies(delta);
    this.pool.update(delta);
  }

  get renderedCount() {
    return this.pool.activeCount;
  }

  _isOutdoor(s) {
    return s.activity === Commuting || s.activity === Leisure;
  }

  _reconcile(px, pz) {
    const t = this.clock.minutesOfDay;
    const day = this.clock.day;
    const rAct2 = this.activationRadius * this.activationRadius;
    const rRel2 = this.releaseRadius * this.releaseRadius;
    const tileReach = this.releaseRadius + this.tileSize;

    // A. Release/refresh already-active bodies. Uses the body's record + real
    // (walked) position, so it's independent of the tile pre-filter below.
    for (const [id, body] of [...this.pool.active]) {
      const s = scheduleState(body.rec, t, day);
      const bx = body.object.position.x;
      const bz = body.object.position.z;
      if (!this._isOutdoor(s) || (bx - px) ** 2 + (bz - pz) ** 2 > rRel2) {
        this.pool.release(id);
        continue;
      }
      const dest = this._destAnchor(body.rec, s);
      body.destX = dest[0];
      body.destZ = dest[1];
    }

    // B. Consider citizens homed in nearby tiles for NEW bodies.
    const counts = { AtHome: 0, AtWork: 0, Commuting: 0, Leisure: 0 };
    const candidates = [];
    for (const key of this._activeTiles) {
      const [tx, tz] = key.split('_').map(Number);
      const cx = (tx + 0.5) * this.tileSize;
      const cz = (tz + 0.5) * this.tileSize;
      if (Math.abs(cx - px) > tileReach || Math.abs(cz - pz) > tileReach) continue;

      for (const rec of this.store.getCitizens(key)) {
        const s = scheduleState(rec, t, day);
        counts[s.activity]++;
        if (!this._isOutdoor(s) || this.pool.isActive(rec.id)) continue;
        const start = this._startAnchor(rec, s);
        const dsq = (start[0] - px) ** 2 + (start[1] - pz) ** 2;
        if (dsq <= rAct2) candidates.push({ rec, s, dsq });
      }
    }
    this._activityCounts = counts;

    // C. Acquire nearest-first until the pool is full.
    candidates.sort((a, b) => a.dsq - b.dsq);
    for (const c of candidates) {
      if (!this.pool.hasFree) break;
      const body = this.pool.acquire(c.rec.id);
      if (!body) break;
      body.rec = c.rec;
      const start = this._snapToRoad(this._startAnchor(c.rec, c.s));
      body.setPositionYaw(start[0], 0, start[1], unitHash(c.rec.id, 'yaw') * Math.PI * 2);
      const dest = this._destAnchor(c.rec, c.s);
      body.destX = dest[0];
      body.destZ = dest[1];
    }
  }

  /** Per-frame: walk every active body toward its destination along the roads. */
  _advanceBodies(delta) {
    const step = WALK_SPEED_MPS * delta;
    for (const body of this.pool.active.values()) {
      const bx = body.object.position.x;
      const bz = body.object.position.z;
      const dd = Math.hypot(body.destX - bx, body.destZ - bz);
      if (dd < ARRIVE_DIST_M) {
        body.setState('idle'); // arrived — mill/stand
        continue;
      }
      const roads = this.tileManager.getNearbyRoads(bx, bz);
      const next = stepAlongRoads(bx, bz, roads, body.destX, body.destZ, step);
      body.setPositionYaw(next.x, 0, next.z, next.yaw);
      body.setState('walk');
    }
  }

  /** Where a citizen currently is (for selection/spawn): the departure anchor. */
  _startAnchor(rec, s) {
    if (s.activity === Leisure) return rec.leisureXZ;
    return this._namedAnchor(rec, s.from); // Commuting: leaving `from`
  }

  /** Where a citizen is headed (for walking): the arrival anchor. */
  _destAnchor(rec, s) {
    if (s.activity === Leisure) return rec.leisureXZ;
    return this._namedAnchor(rec, s.to); // Commuting: toward `to`
  }

  _namedAnchor(rec, anchor) {
    if (anchor === 'work') return rec.workXZ;
    if (anchor === 'leisure') return rec.leisureXZ;
    return rec.homeXZ;
  }

  _snapToRoad([ax, az]) {
    const roads = this.tileManager.getNearbyRoads(ax, az);
    if (roads.length) {
      const snap = nearestPointOnPolylines(roads, ax, az);
      if (snap && snap.dist <= SNAP_MAX_M) return [snap.x, snap.z];
    }
    return [ax, az];
  }
}
