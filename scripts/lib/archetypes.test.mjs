import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHETYPES,
  ARCHETYPE_INDEX,
  ARCHETYPE_MIX,
  WORKPLACE_ELIGIBILITY,
  archetypeForRoll,
  homeCapacity,
  jobCapacity,
} from './archetypes.mjs';

test('archetype mix sums to 1', () => {
  const sum = Object.values(ARCHETYPE_MIX).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `mix sums to ${sum}`);
});

test('every archetype has a mix weight and eligibility entry', () => {
  for (const a of ARCHETYPES) {
    assert.ok(a in ARCHETYPE_MIX, `${a} missing from mix`);
    assert.ok(a in WORKPLACE_ELIGIBILITY, `${a} missing eligibility`);
  }
});

test('ARCHETYPE_INDEX is a stable forward map', () => {
  assert.equal(ARCHETYPE_INDEX[ARCHETYPES[0]], 0);
  assert.equal(ARCHETYPES[ARCHETYPE_INDEX.retiree], 'retiree');
});

test('archetypeForRoll covers the [0,1) range and matches the distribution', () => {
  const counts = Object.fromEntries(ARCHETYPES.map((a) => [a, 0]));
  const N = 100000;
  for (let i = 0; i < N; i++) counts[archetypeForRoll(i / N)]++;
  for (const a of ARCHETYPES) {
    const frac = counts[a] / N;
    assert.ok(Math.abs(frac - ARCHETYPE_MIX[a]) < 0.01, `${a}: ${frac} vs ${ARCHETYPE_MIX[a]}`);
  }
});

test('archetypeForRoll is total (0 and near-1 both resolve)', () => {
  assert.ok(ARCHETYPES.includes(archetypeForRoll(0)));
  assert.ok(ARCHETYPES.includes(archetypeForRoll(0.999999)));
});

test('homeCapacity: house is a household, apartments scale, always >= 1', () => {
  assert.equal(homeCapacity(90, 4, 'house'), 3);
  assert.ok(homeCapacity(400, 12, 'apartments') > homeCapacity(90, 4, 'apartments'));
  assert.ok(homeCapacity(1, 3, 'residential') >= 1);
});

test('homeCapacity caps runaway heights', () => {
  const tall = homeCapacity(300, 3000, 'apartments'); // absurd height from bad data
  const capped = homeCapacity(300, 36, 'apartments'); // 12 floors
  assert.equal(tall, capped);
});

test('jobCapacity is >= 1 and denser for schools than industry', () => {
  assert.ok(jobCapacity(1, 3, 'office') >= 1);
  const school = jobCapacity(1000, 9, 'school');
  const industrial = jobCapacity(1000, 9, 'industrial');
  assert.ok(school > industrial, `school ${school} should exceed industrial ${industrial}`);
});
