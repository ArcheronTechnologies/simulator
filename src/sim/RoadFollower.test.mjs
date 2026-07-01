import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepAlongRoads } from './RoadFollower.js';

// A straight road along +X at z=0.
const straightRoad = [{ p: [0, 0, 100, 0] }];

test('walks along the road toward the destination', () => {
  const s = stepAlongRoads(10, 0, straightRoad, 90, 0, 2);
  assert.ok(s.onRoad);
  assert.ok(Math.abs(s.x - 12) < 1e-6, `expected x~12, got ${s.x}`);
  assert.ok(Math.abs(s.z) < 1e-6);
});

test('reverses direction when the destination is the other way', () => {
  const s = stepAlongRoads(50, 0, straightRoad, 0, 0, 2);
  assert.ok(s.x < 50, `should move toward x=0, got ${s.x}`);
});

test('snaps back onto the road if the walker drifts off', () => {
  // Start 5m off the road; the step should land on (or return to) z=0.
  const s = stepAlongRoads(10, 5, straightRoad, 90, 0, 2);
  assert.ok(Math.abs(s.z) < 1e-6, `should snap to road z=0, got ${s.z}`);
});

test('faces the direction of travel (app yaw convention)', () => {
  // Moving toward +X, facing +X: yaw = atan2(-1, 0) = -PI/2.
  const s = stepAlongRoads(10, 0, straightRoad, 90, 0, 2);
  assert.ok(Math.abs(s.yaw - (-Math.PI / 2)) < 1e-6, `yaw ${s.yaw}`);
});

test('falls back to straight-line movement with no roads', () => {
  const s = stepAlongRoads(0, 0, [], 10, 0, 2);
  assert.equal(s.onRoad, false);
  assert.ok(Math.abs(s.x - 2) < 1e-6);
  assert.ok(Math.abs(s.z) < 1e-6);
});

test('picks the nearer road and follows it', () => {
  const roads = [{ p: [0, 0, 100, 0] }, { p: [0, 50, 100, 50] }];
  // Near the second road (z=50), heading to x=90 -> should stay near z=50.
  const s = stepAlongRoads(10, 49, roads, 90, 50, 2);
  assert.ok(Math.abs(s.z - 50) < 1e-6, `should follow z=50 road, got ${s.z}`);
  assert.ok(s.x > 10);
});

test('turns a corner: an L-shaped road routes the walker around the bend', () => {
  // Road goes east to (100,0) then north to (100,100). Walker near the corner
  // heading for (100,100) should end up moving north after the bend.
  const L = [{ p: [0, 0, 100, 0, 100, 100] }];
  const s = stepAlongRoads(100, 2, L, 100, 100, 2);
  assert.ok(Math.abs(s.x - 100) < 1e-6);
  assert.ok(s.z > 2, `should progress north, got z=${s.z}`);
});
