import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleState,
  daySegments,
  MINUTES_PER_DAY,
  AtHome,
  AtWork,
  Commuting,
  Leisure,
} from './schedule.mjs';
import { ARCHETYPES, archetypeForRoll } from './archetypes.mjs';
import { unitHash } from './hash.mjs';

const WEEKDAY = 1;

function citizen(id, arch) {
  return { id, arch };
}

test('segments tile [0,1440) with no gaps or overlaps for every archetype', () => {
  for (const arch of ARCHETYPES) {
    for (let id = 0; id < 50; id++) {
      const segs = daySegments(citizen(id, arch), WEEKDAY);
      assert.equal(segs[0].start, 0, `${arch}/${id} must start at 0`);
      assert.equal(segs[segs.length - 1].end, MINUTES_PER_DAY, `${arch}/${id} must end at 1440`);
      for (let i = 1; i < segs.length; i++) {
        assert.equal(segs[i].start, segs[i - 1].end, `${arch}/${id} gap/overlap at ${i}`);
      }
    }
  }
});

test('scheduleState is total and deterministic across the whole day', () => {
  for (const arch of ARCHETYPES) {
    const c = citizen(7, arch);
    for (let t = 0; t < MINUTES_PER_DAY; t += 7) {
      const s = scheduleState(c, t, WEEKDAY);
      assert.ok([AtHome, AtWork, Commuting, Leisure].includes(s.activity));
      assert.deepEqual(s, scheduleState(c, t, WEEKDAY)); // deterministic
    }
  }
});

test('scheduleState wraps time (t and t+1440 identical)', () => {
  const c = citizen(3, 'worker');
  assert.deepEqual(scheduleState(c, 600, WEEKDAY), scheduleState(c, 600 + MINUTES_PER_DAY, WEEKDAY));
  assert.deepEqual(scheduleState(c, 600, WEEKDAY), scheduleState(c, 600 - MINUTES_PER_DAY, WEEKDAY));
});

test('commute phase is monotonic within a commuting window', () => {
  // Find a worker's morning commute window and check phase rises 0->~1.
  const c = citizen(11, 'worker');
  const segs = daySegments(c, WEEKDAY);
  const commute = segs.find((s) => s.activity === Commuting);
  assert.ok(commute, 'worker should have a commute');
  let prev = -1;
  for (let t = commute.start; t < commute.end; t++) {
    const p = scheduleState(c, t, WEEKDAY).phase;
    assert.ok(p >= 0 && p <= 1);
    assert.ok(p >= prev, 'phase must be non-decreasing');
    prev = p;
  }
});

test('nobody leaves home in the dead of night (workers)', () => {
  for (let id = 0; id < 200; id++) {
    const s = scheduleState(citizen(id, 'worker'), 3 * 60, WEEKDAY); // 03:00
    assert.equal(s.activity, AtHome, `worker ${id} should be home at 03:00`);
  }
});

// The load-bearing guard against implausibly empty or mobbed streets.
function occupancy(t, day, N = 4000) {
  const counts = { AtHome: 0, AtWork: 0, Commuting: 0, Leisure: 0 };
  for (let id = 0; id < N; id++) {
    const arch = archetypeForRoll(unitHash(id, 'arch'));
    counts[scheduleState(citizen(id, arch), t, day).activity]++;
  }
  for (const k of Object.keys(counts)) counts[k] /= N;
  return counts;
}

test('aggregate occupancy: ~everyone home at 03:00', () => {
  const o = occupancy(3 * 60, WEEKDAY);
  assert.ok(o.AtHome > 0.9, `expected >90% home at 03:00, got ${(o.AtHome * 100).toFixed(1)}%`);
});

test('aggregate occupancy: many at work midday, few home', () => {
  const o = occupancy(12 * 60, WEEKDAY);
  assert.ok(o.AtWork > 0.45, `expected >45% at work at noon, got ${(o.AtWork * 100).toFixed(1)}%`);
  assert.ok(o.AtHome < 0.5, `expected <50% home at noon, got ${(o.AtHome * 100).toFixed(1)}%`);
});

test('aggregate occupancy: rush hour puts people on the move', () => {
  const morning = occupancy(8 * 60 + 10, WEEKDAY); // 08:10
  assert.ok(morning.Commuting > 0.08, `expected a visible commuting bump, got ${(morning.Commuting * 100).toFixed(1)}%`);
});

test('weekends look different from weekdays (fewer at work at noon)', () => {
  const weekdayNoon = occupancy(12 * 60, 1).AtWork;
  const weekendNoon = occupancy(12 * 60, 6).AtWork;
  assert.ok(weekendNoon < weekdayNoon, `weekend work (${weekendNoon}) should be below weekday (${weekdayNoon})`);
});
