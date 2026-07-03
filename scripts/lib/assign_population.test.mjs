import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignPopulation } from './assign_population.mjs';
import { ARCHETYPES, ARCHETYPE_INDEX } from './archetypes.mjs';

function fixture() {
  return {
    homes: [
      { x: 10, z: 10, capacity: 3, subtype: 'house' },
      { x: 250, z: 250, capacity: 5, subtype: 'apartments' },
      { x: -400, z: 120, capacity: 2, subtype: 'house' },
    ],
    workplaces: [
      { x: 300, z: 300, subtype: 'office' },
      { x: 60, z: 60, subtype: 'retail' },
      { x: 120, z: 120, subtype: 'school' },
      { x: 140, z: 90, subtype: 'university' },
    ],
    leisureSpots: [{ x: 0, z: 0 }, { x: 200, z: 200 }],
  };
}

test('fills every home to capacity and totals correctly', () => {
  const { citizens, stats } = assignPopulation(fixture());
  assert.equal(citizens.length, 3 + 5 + 2);
  assert.equal(stats.total, citizens.length);
});

test('assigns globally-sequential ids and valid archetype indices', () => {
  const { citizens } = assignPopulation(fixture());
  citizens.forEach((c, i) => {
    assert.equal(c.id, i);
    assert.ok(c.arch >= 0 && c.arch < ARCHETYPES.length);
  });
});

test('every citizen gets a home, work, and leisure position + tiles', () => {
  const { citizens } = assignPopulation(fixture());
  for (const c of citizens) {
    assert.equal(c.homeXZ.length, 2);
    assert.equal(c.workXZ.length, 2);
    assert.equal(c.leisureXZ.length, 2);
    assert.match(c.homeTile, /^-?\d+_-?\d+$/);
    assert.match(c.workTile, /^-?\d+_-?\d+$/);
  }
});

test('is fully deterministic (same input => identical output)', () => {
  const a = assignPopulation(fixture());
  const b = assignPopulation(fixture());
  assert.deepEqual(a.citizens, b.citizens);
  assert.deepEqual(a.stats, b.stats);
});

test('id ordering is stable regardless of input home order', () => {
  const f1 = fixture();
  const f2 = fixture();
  f2.homes.reverse(); // shuffle input order
  const a = assignPopulation(f1);
  const b = assignPopulation(f2);
  // Same citizens (sorted internally by position), so home positions per id match.
  assert.deepEqual(a.citizens.map((c) => c.homeXZ), b.citizens.map((c) => c.homeXZ));
});

test('workplace assignment is distance-biased toward nearer jobs', () => {
  // A dedicated fixture: one home, one near office, one far office. Workers
  // should overwhelmingly land at the near one.
  const input = {
    homes: [{ x: 0, z: 0, capacity: 200, subtype: 'apartments' }],
    workplaces: [{ x: 20, z: 20, subtype: 'office' }, { x: 5000, z: 5000, subtype: 'office' }],
    leisureSpots: [{ x: 0, z: 0 }],
  };
  const { citizens } = assignPopulation(input);
  const workers = citizens.filter((c) => c.arch === ARCHETYPE_INDEX.worker);
  const near = workers.filter((c) => c.workXZ[0] === 20).length;
  assert.ok(near / workers.length > 0.8, `expected most workers at the near office, got ${near}/${workers.length}`);
});

test('archetypes needing work but with no eligible workplace fall back to home', () => {
  // No workplaces at all: workers/students/children should become "home".
  const input = {
    homes: [{ x: 0, z: 0, capacity: 300, subtype: 'apartments' }],
    workplaces: [],
    leisureSpots: [],
  };
  const { citizens, stats } = assignPopulation(input);
  assert.equal(stats.withWork, 0);
  for (const c of citizens) {
    // work anchor collapses onto home when there's nowhere to work
    assert.deepEqual(c.workXZ, c.homeXZ);
  }
});

test('populationScale scales the total', () => {
  const base = assignPopulation(fixture()).stats.total;
  const scaled = assignPopulation({ ...fixture(), populationScale: 2 }).stats.total;
  assert.ok(scaled > base);
});
