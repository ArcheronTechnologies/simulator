import { scheduleState, Leisure, Commuting } from '../../scripts/lib/schedule.mjs';
import { nearestPointOnPolylines } from '../../scripts/lib/spatial.mjs';
import { stepAlongRoads } from './RoadFollower.js';
import { unitHash } from '../../scripts/lib/hash.mjs';
import { tileIndex, tileKey } from '../core/geo.js';

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
// Force-release a body that's been continuously walking this long without
// arriving (an unreachable/pathological destination). 420s (~567m at
// WALK_SPEED_MPS) comfortably covers a real walk within the activation/
// release radii (620m) while bounding worst-case pool-slot occupancy.
const MAX_WALK_S = 420;

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
      // The tile may have unloaded (and possibly reloaded under a different
      // fetch) while the shard fetch was in flight. tileManager.loaded is the
      // ground truth for what world geometry is actually present right now --
      // recheck against it rather than trusting store.hasTile, which only
      // means "the manifest lists a shard for this key", not "still wanted".
      if (!this.tileManager.loaded.has(key)) {
        this.store.unloadTile(key); // clean up the entry this late fetch just populated
        return;
      }
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

    // A. Evaluate every already-active body against its CURRENT schedule and
    // LIVE (walked) position. A body is force-released only for reasons that
    // are true regardless of how many citizens are competing for a slot: it
    // wandered past the release radius, its safety valve tripped, or it has
    // both gone indoors AND actually arrived (going indoors alone used to be
    // enough, which vanished bodies mid-street). Everyone else survives into
    // the nearest-N ranking in step C below.
    const kept = [];
    for (const [id, body] of [...this.pool.active]) {
      const s = scheduleState(body.rec, t, day);
      const bx = body.object.position.x;
      const bz = body.object.position.z;
      const dsq = (bx - px) ** 2 + (bz - pz) ** 2;
      const dest = this._snapToRoad(this._destAnchor(body.rec, s));
      const arrived = (dest[0] - bx) ** 2 + (dest[1] - bz) ** 2 <= ARRIVE_DIST_M * ARRIVE_DIST_M;
      const mustRelease = dsq > rRel2 || body.walkElapsedS > MAX_WALK_S || (!this._isOutdoor(s) && arrived);
      if (mustRelease) {
        this.pool.release(id);
        continue;
      }
      body.destX = dest[0];
      body.destZ = dest[1];
      kept.push({ id, rec: body.rec, s, dsq });
    }

    // B. Consider citizens homed in nearby tiles as candidates for a body,
    // skipping anyone already active (already accounted for in `kept`).
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
        if (dsq <= rAct2) candidates.push({ id: rec.id, rec, s, dsq });
      }
    }
    this._activityCounts = counts;

    // C. Rank everyone still-in-play (active + candidate) by distance to the
    // player and keep only the nearest `capacity`. This restores the
    // continuous nearest-N eviction the RoadFollower rewrite dropped,
    // adapted for live per-body positions: active bodies rank by where
    // they've actually walked to, candidates rank by their (not-yet-visited)
    // start anchor. A candidate that ranks inside the top `capacity` evicts
    // the farthest active body even if that body hasn't arrived yet --
    // eviction-by-rank deliberately overrides step A's "wait for arrival":
    // if `capacity` truly-closer citizens exist, showing them matters more
    // than one cut-short arrival, and it's far rarer than the old
    // near-universal mid-street vanishing.
    const ranked = [...kept, ...candidates].sort((a, b) => a.dsq - b.dsq);
    const keepIds = new Set();
    for (const entry of ranked) {
      if (keepIds.size >= this.capacity) break;
      keepIds.add(entry.id);
    }
    for (const k of kept) {
      if (!keepIds.has(k.id)) this.pool.release(k.id);
    }

    // D. Acquire/place the kept candidates (already-active bodies in `kept`
    // were already placed in step A above).
    for (const c of candidates) {
      if (!keepIds.has(c.id)) continue;
      if (!this.pool.hasFree) break; // shouldn't happen given step C's accounting, but stay defensive
      const body = this.pool.acquire(c.id);
      if (!body) break;
      body.rec = c.rec;
      const start = this._snapToRoad(this._startAnchor(c.rec, c.s));
      body.setPositionYaw(start[0], 0, start[1], unitHash(c.id, 'yaw') * Math.PI * 2);
      const dest = this._snapToRoad(this._destAnchor(c.rec, c.s));
      body.destX = dest[0];
      body.destZ = dest[1];
    }
  }

  /** Per-frame: walk every active body toward its destination along the roads. */
  _advanceBodies(delta) {
    const step = WALK_SPEED_MPS * delta;
    const roadsByTile = new Map(); // per-frame cache -- tile membership doesn't change mid-frame
    for (const body of this.pool.active.values()) {
      const bx = body.object.position.x;
      const bz = body.object.position.z;
      const dd = Math.hypot(body.destX - bx, body.destZ - bz);
      if (dd < ARRIVE_DIST_M) {
        body.setState('idle'); // arrived — mill/stand
        continue;
      }
      body.walkElapsedS += delta;
      const { tx, tz } = tileIndex(bx, bz, this.tileSize);
      const key = tileKey(tx, tz);
      let roads = roadsByTile.get(key);
      if (!roads) {
        roads = this.tileManager.getNearbyRoads(bx, bz);
        roadsByTile.set(key, roads);
      }
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
