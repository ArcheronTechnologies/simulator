import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closestPointOnSegment,
  nearestPointOnPolylines,
  ringArea,
  signedRingArea,
  centroidOfRing,
} from './spatial.mjs';

test('closestPointOnSegment clamps to endpoints', () => {
  // Point beyond the b end projects onto b.
  const c = closestPointOnSegment(20, 0, 0, 0, 10, 0);
  assert.equal(c.x, 10);
  assert.equal(c.z, 0);
  assert.equal(c.t, 1);
  // Point before a projects onto a.
  const c2 = closestPointOnSegment(-5, 3, 0, 0, 10, 0);
  assert.equal(c2.x, 0);
  assert.equal(c2.t, 0);
});

test('closestPointOnSegment finds the perpendicular foot', () => {
  const c = closestPointOnSegment(5, 4, 0, 0, 10, 0);
  assert.equal(c.x, 5);
  assert.equal(c.z, 0);
  assert.equal(c.distSq, 16);
});

test('nearestPointOnPolylines picks the closest segment across lines', () => {
  const lines = [
    [0, 0, 10, 0], // along z=0
    [0, 100, 10, 100], // far away
  ];
  const r = nearestPointOnPolylines(lines, 5, 1);
  assert.equal(r.line, 0);
  assert.equal(r.seg, 0);
  assert.ok(Math.abs(r.x - 5) < 1e-9);
  assert.ok(Math.abs(r.dist - 1) < 1e-9);
});

test('nearestPointOnPolylines accepts {p:[...]} road entries', () => {
  const roads = [{ p: [0, 0, 0, 10], n: 'Test' }];
  const r = nearestPointOnPolylines(roads, 2, 5);
  assert.ok(Math.abs(r.x - 0) < 1e-9);
  assert.ok(Math.abs(r.z - 5) < 1e-9);
  assert.ok(Math.abs(r.dist - 2) < 1e-9);
});

test('nearestPointOnPolylines returns null with no segments', () => {
  assert.equal(nearestPointOnPolylines([], 0, 0), null);
  assert.equal(nearestPointOnPolylines([[1, 2]], 0, 0), null); // single point, no segment
});

test('ringArea computes a unit square', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(ringArea(sq), 100);
});

test('signedRingArea sign depends on winding', () => {
  const ccw = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const cw = [...ccw].reverse();
  assert.ok(signedRingArea(ccw) > 0 !== signedRingArea(cw) > 0);
});

test('centroidOfRing finds the center of a square', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const [cx, cz] = centroidOfRing(sq);
  assert.ok(Math.abs(cx - 5) < 1e-9);
  assert.ok(Math.abs(cz - 5) < 1e-9);
});

test('centroidOfRing handles a degenerate (zero-area) ring', () => {
  const line = [[0, 0], [10, 0], [0, 0]];
  const [cx, cz] = centroidOfRing(line);
  assert.ok(Number.isFinite(cx) && Number.isFinite(cz));
});
