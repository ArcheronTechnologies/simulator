import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PopulationManager } from './PopulationManager.js';

// PopulationManager has zero THREE/DOM dependencies -- these are real, fast
// node:test unit tests against plain fakes for pool/store/tileManager, no
// browser needed.

function fakeBody() {
  return {
    object: { position: { x: 0, y: 0, z: 0 } },
    destX: 0,
    destZ: 0,
    stallElapsedS: 0,
    bestDestDistM: Infinity,
    rec: null,
    setPositionYaw(x, y, z, yaw) {
      this.object.position.x = x;
      this.object.position.y = y;
      this.object.position.z = z;
      this._yaw = yaw;
    },
    setState(s) {
      this._state = s;
    },
  };
}

function fakePool(capacity) {
  const free = Array.from({ length: capacity }, fakeBody);
  const active = new Map();
  return {
    free,
    active,
    get hasFree() {
      return free.length > 0;
    },
    isActive(id) {
      return active.has(id);
    },
    acquire(id) {
      if (active.has(id)) return active.get(id);
      const body = free.pop();
      if (!body) return null;
      body.stallElapsedS = 0;
      body.bestDestDistM = Infinity;
      active.set(id, body);
      return body;
    },
    release(id) {
      const body = active.get(id);
      if (!body) return;
      active.delete(id);
      free.push(body);
    },
  };
}

function citizen(id, { homeXZ = [0, 0], workXZ = [0, 0], leisureXZ = [0, 0] } = {}) {
  return { id, arch: 0, homeXZ, workXZ, leisureXZ }; // arch:0 = 'worker'
}

function makeManager({ capacity = 150, citizensByTile = {}, activationRadius = 500, releaseRadius = 600, roads = [] } = {}) {
  const pool = fakePool(capacity);
  const store = { getCitizens: (key) => citizensByTile[key] ?? [] };
  const tileManager = { loaded: new Map([['0_0', {}]]), getNearbyRoads: () => roads };
  const clock = { minutesOfDay: 0, day: 1 };
  const mgr = new PopulationManager({ store, pool, clock, tileManager, activationRadius, releaseRadius, capacity, tileSize: 500 });
  mgr._activeTiles.add('0_0');
  return { mgr, pool };
}

// Real, id-1/id-3 ('worker' archetype, weekday) schedule facts confirmed by
// direct computation against scripts/lib/schedule.mjs before writing these
// tests (not guessed): at t=498, citizen 1 is Commuting home->work (segment
// 497-529) and citizen 3 is ALSO Commuting home->work (segment 483-515) --
// both genuinely outdoor at the same instant. At t=600, citizen 1 is AtWork
// (indoors).
const T_COMMUTING = 498;
const T_AT_WORK = 600;

test('F2: a body that has not arrived is NOT released when its schedule goes indoors', () => {
  const rec = citizen(1, { homeXZ: [0, 0], workXZ: [5000, 0] });
  const { mgr, pool } = makeManager({ citizensByTile: { '0_0': [rec] } });

  mgr.clock.minutesOfDay = T_COMMUTING;
  mgr._reconcile(0, 0); // acquire during the commute
  assert.ok(pool.isActive(1), 'should have acquired a body for the commuting citizen');
  const body = pool.active.get(1);
  body.object.position.x = 50; // walked a bit, nowhere near work (5000m away)

  mgr.clock.minutesOfDay = T_AT_WORK; // schedule now says AtWork
  mgr._reconcile(50, 0);
  assert.ok(pool.isActive(1), 'must keep walking, not vanish mid-street');
});

test('F2: an arrived body IS released once its schedule goes indoors', () => {
  const rec = citizen(1, { homeXZ: [0, 0], workXZ: [10, 0] });
  const { mgr, pool } = makeManager({ citizensByTile: { '0_0': [rec] } });

  mgr.clock.minutesOfDay = T_COMMUTING;
  mgr._reconcile(0, 0);
  const body = pool.active.get(1);
  body.object.position.x = 10; // at work already (within ARRIVE_DIST_M)

  mgr.clock.minutesOfDay = T_AT_WORK;
  mgr._reconcile(10, 0);
  assert.equal(pool.isActive(1), false);
});

test('R1: stall valve force-releases a body making no progress toward its destination', () => {
  // Start anchor (home) is placed far from wherever the player ends up, so a
  // release isn't immediately masked by the citizen re-qualifying as a fresh
  // phase-B candidate in the same reconcile pass -- that re-acquisition is
  // itself correct (a released citizen just gets a fresh walk from home if
  // still genuinely nearby), but this test isolates the release trigger.
  const rec = citizen(1, { homeXZ: [50000, 0], workXZ: [5000, 0] });
  const { mgr, pool } = makeManager({ citizensByTile: {} }); // acquire manually below, not via candidacy
  pool.acquire(1);
  const body = pool.active.get(1);
  body.rec = rec;
  body.object.position.x = 50;
  body.stallElapsedS = 200; // past the 120s valve, still Commuting (outdoor) and unarrived

  mgr.clock.minutesOfDay = T_COMMUTING; // still mid-commute
  mgr._reconcile(50, 0);
  assert.equal(pool.isActive(1), false);
});

test('R1: stall valve does not trip on a long walk that keeps making progress', () => {
  // A body 600m from its destination (well past MAX_STALL_S=120s of walking
  // at WALK_SPEED_MPS=1.35 -- that alone covers only ~162m) but advancing
  // steadily every frame must never accumulate stall time, because each
  // frame beats its previous best distance. This is exactly the "long but
  // legitimate walk" case the duration-based MAX_WALK_S valve used to kill.
  const tileManager = { loaded: new Map(), getNearbyRoads: () => [] };
  const pool = fakePool(1);
  const mgr = new PopulationManager({ store: {}, pool, clock: { minutesOfDay: 0, day: 1 }, tileManager, activationRadius: 1, releaseRadius: 1, capacity: 1, tileSize: 500 });
  const body = pool.acquire(1);
  body.destX = 600;
  body.destZ = 0;

  for (let i = 0; i < 500; i++) mgr._advanceBodies(1); // 500 one-second ticks, no roads so straight-line stepping
  assert.ok(body.stallElapsedS < 5, `expected the stall timer to keep resetting on progress, got ${body.stallElapsedS}s`);
});

test('R1: stall valve accumulates when a body cannot get closer (stuck/unreachable target)', () => {
  const tileManager = { loaded: new Map(), getNearbyRoads: () => [] };
  const pool = fakePool(1);
  const mgr = new PopulationManager({ store: {}, pool, clock: { minutesOfDay: 0, day: 1 }, tileManager, activationRadius: 1, releaseRadius: 1, capacity: 1, tileSize: 500 });
  const body = pool.acquire(1);
  body.destX = 600;
  body.destZ = 0;

  // Reset to the same starting point before every tick, so _advanceBodies
  // sees an identical distance-to-destination each time no matter how it
  // just moved the body -- modeling a walker that's genuinely stuck (e.g.
  // bouncing off a dead-end road snap) rather than one making real headway.
  for (let i = 0; i < 130; i++) {
    body.object.position.x = 5000;
    body.object.position.z = 0;
    mgr._advanceBodies(1);
  }
  assert.ok(body.stallElapsedS > 120, `expected the stall timer to exceed MAX_STALL_S from repeated non-improvement, got ${body.stallElapsedS}s`);
});

test('F3: destination is snapped to the nearest road, not the raw off-road anchor', () => {
  const rec = citizen(1, { homeXZ: [0, 0], workXZ: [40, 90] }); // 90m off any road
  const road = [{ p: [0, 0, 40, 0] }]; // straight road along z=0
  const { mgr, pool } = makeManager({ citizensByTile: { '0_0': [rec] }, roads: road });

  mgr.clock.minutesOfDay = T_COMMUTING;
  mgr._reconcile(0, 0);
  const body = pool.active.get(1);
  assert.ok(Math.abs(body.destZ) < 1e-6, `destination should snap onto the road (z~0), got z=${body.destZ}`);
});

test('F3: _snapToRoad falls back to the raw point when nothing is within SNAP_MAX_M', () => {
  const road = [{ p: [0, 0, 40, 0] }];
  const { mgr } = makeManager({ roads: road });
  const [x, z] = mgr._snapToRoad([40, 500]); // 500m away, beyond SNAP_MAX_M=130
  assert.equal(x, 40);
  assert.equal(z, 500);
});

test('F4: nearest-capacity eviction replaces a farther active body with a closer candidate', () => {
  const far = citizen(1, { homeXZ: [400, 0], workXZ: [400, 0] }); // within the default 500m activation radius
  const near = citizen(3, { homeXZ: [10, 0], workXZ: [10, 0] });
  const { mgr, pool } = makeManager({ capacity: 1, citizensByTile: { '0_0': [far] } });

  mgr.clock.minutesOfDay = T_COMMUTING;
  mgr._reconcile(0, 0);
  assert.ok(pool.isActive(1), 'far citizen should acquire the only slot first');

  // Now `near` becomes a candidate too, with capacity still 1 -- near must evict far.
  mgr.store.getCitizens = (key) => (key === '0_0' ? [far, near] : []);
  mgr._reconcile(0, 0);
  assert.equal(pool.isActive(3), true, 'the closer candidate must be acquired');
  assert.equal(pool.isActive(1), false, 'the farther active body must be evicted to make room');
});

// Real schedule facts for the R3 tests below, confirmed the same way as the
// T_COMMUTING/T_AT_WORK facts above: ids 1, 9, and 11 ('worker' archetype)
// are all genuinely Commuting (outdoor) at t=498.
test('R3: eviction hysteresis keeps a walking body against only a marginally closer candidate', () => {
  const active = citizen(1, { homeXZ: [0, 0], workXZ: [5000, 0] });
  // 90m from the player: closer than the active body's live 100m, but not
  // past the ACTIVE_RANK_BIAS=0.7 hysteresis band (candidate must beat
  // 100 * sqrt(0.7) =~ 83.7m to evict).
  const nearMiss = citizen(9, { homeXZ: [90, 0], workXZ: [90, 0] });
  const { mgr, pool } = makeManager({ capacity: 1, citizensByTile: { '0_0': [active] } });

  mgr.clock.minutesOfDay = T_COMMUTING;
  mgr._reconcile(0, 0);
  assert.ok(pool.isActive(1), 'active citizen should acquire the only slot');
  pool.active.get(1).object.position.x = 100; // simulates having walked to 100m from the player

  mgr.store.getCitizens = (key) => (key === '0_0' ? [active, nearMiss] : []);
  mgr._reconcile(0, 0);
  assert.equal(pool.isActive(1), true, 'a candidate only marginally closer must not evict a body already walking');
  assert.equal(pool.isActive(9), false);
});

test('R3: eviction hysteresis still lets a meaningfully closer candidate evict', () => {
  const active = citizen(1, { homeXZ: [0, 0], workXZ: [5000, 0] });
  const closer = citizen(11, { homeXZ: [50, 0], workXZ: [50, 0] }); // well past the hysteresis-adjusted cutoff
  const { mgr, pool } = makeManager({ capacity: 1, citizensByTile: { '0_0': [active] } });

  mgr.clock.minutesOfDay = T_COMMUTING;
  mgr._reconcile(0, 0);
  pool.active.get(1).object.position.x = 100;

  mgr.store.getCitizens = (key) => (key === '0_0' ? [active, closer] : []);
  mgr._reconcile(0, 0);
  assert.equal(pool.isActive(11), true, 'a meaningfully closer candidate must still evict');
  assert.equal(pool.isActive(1), false);
});

test('R4: _reconcile shares one getNearbyRoads call per distinct tile across all snaps', () => {
  let calls = 0;
  const recA = citizen(1, { homeXZ: [10, 10], workXZ: [40, 90] }); // both in tile 0_0
  const recB = citizen(9, { homeXZ: [20, 20], workXZ: [45, 95] }); // also tile 0_0
  const pool = fakePool(2);
  const store = { getCitizens: (key) => (key === '0_0' ? [recA, recB] : []) };
  const tileManager = { loaded: new Map([['0_0', {}]]), getNearbyRoads: () => { calls++; return [{ p: [0, 0, 40, 0] }]; } };
  const clock = { minutesOfDay: T_COMMUTING, day: 1 };
  const mgr = new PopulationManager({ store, pool, clock, tileManager, activationRadius: 500, releaseRadius: 600, capacity: 2, tileSize: 500 });
  mgr._activeTiles.add('0_0');

  mgr._reconcile(0, 0);
  assert.ok(pool.isActive(1) && pool.isActive(9), 'both candidates should have been acquired');
  // 2 citizens x (start snap + dest snap) = 4 raw snap calls, all landing in
  // tile 0_0 -- must collapse to 1 getNearbyRoads call, not 4.
  assert.equal(calls, 1, `expected exactly one getNearbyRoads call for the one distinct tile involved, got ${calls}`);
});

test('R5: onTileLoaded does not activate a tile whose shard fetch failed', async () => {
  const store = {
    ensureTileLoaded: () => Promise.resolve(null), // failed fetch, per PopulationStore's real contract
    hasTile: () => true,
    getCitizens: () => [],
  };
  const tileManager = { loaded: new Map([['0_0', {}]]), getNearbyRoads: () => [] }; // world geometry IS loaded
  const mgr = new PopulationManager({ store, pool: fakePool(1), clock: { minutesOfDay: 0, day: 1 }, tileManager, activationRadius: 1, releaseRadius: 1, capacity: 1, tileSize: 500 });

  mgr.onTileLoaded('0_0');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(mgr._activeTiles.has('0_0'), false, 'a tile whose shard fetch failed must not be marked active with no data');
});

test('F5: a tile that unloads while its shard fetch is in flight is not left orphaned', async () => {
  let resolveShard;
  let unloaded = false;
  const store = {
    ensureTileLoaded: () => new Promise((resolve) => { resolveShard = resolve; }),
    hasTile: () => true,
    isLoaded: () => false,
    unloadTile: () => { unloaded = true; },
    getCitizens: () => [],
  };
  const tileManager = { loaded: new Map(), getNearbyRoads: () => [] }; // key never actually loaded
  const mgr = new PopulationManager({ store, pool: fakePool(1), clock: { minutesOfDay: 0, day: 1 }, tileManager, activationRadius: 1, releaseRadius: 1, capacity: 1, tileSize: 500 });

  mgr.onTileLoaded('0_0'); // fetch starts
  mgr.onTileUnloaded('0_0'); // unloads before the fetch resolves -- both guards no-op today
  resolveShard();
  await Promise.resolve(); // let the .then() microtask run
  await Promise.resolve();

  assert.equal(mgr._activeTiles.has('0_0'), false, 'must not activate a tile that is no longer actually loaded');
  assert.equal(unloaded, true, 'must clean up the store entry the late fetch populated');
});

test('F14: getNearbyRoads is called at most once per distinct tile per _advanceBodies pass', () => {
  let calls = 0;
  const tileManager = { loaded: new Map(), getNearbyRoads: () => { calls++; return []; } };
  const pool = fakePool(3);
  const mgr = new PopulationManager({ store: {}, pool, clock: { minutesOfDay: 0, day: 1 }, tileManager, activationRadius: 1, releaseRadius: 1, capacity: 3, tileSize: 500 });

  // Two bodies in tile "0_0" (x,z in [0,500)), one body in tile "1_0" (x in [500,1000)).
  const b1 = pool.acquire(1);
  b1.object.position.x = 10; b1.object.position.z = 10; b1.destX = 400; b1.destZ = 10;
  const b2 = pool.acquire(2);
  b2.object.position.x = 20; b2.object.position.z = 20; b2.destX = 400; b2.destZ = 20;
  const b3 = pool.acquire(3);
  b3.object.position.x = 520; b3.object.position.z = 10; b3.destX = 900; b3.destZ = 10;

  mgr._advanceBodies(0.1);
  assert.equal(calls, 2, 'expected exactly one getNearbyRoads call per distinct tile (2 tiles), not per body (3 bodies)');
});
