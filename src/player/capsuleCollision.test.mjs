import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ExtendedTriangle } from 'three-mesh-bvh';
import { closestSegmentTriangleDistance, piercedPushDirection } from './capsuleCollision.js';

function makeTriangle(a, b, c) {
  const tri = new ExtendedTriangle();
  tri.a.set(...a);
  tri.b.set(...b);
  tri.c.set(...c);
  tri.needsUpdate = true; // matches iterateOverTriangles' real per-callback flag
  return tri;
}

test('detects a segment piercing straight through a large flat triangle (the actual bug this fixes)', () => {
  // Reproduces the real failing case: a capsule standing in the middle of
  // a huge ground triangle, far from any edge. The upstream library
  // reports ~0.95 clearance here (checked only edges + endpoints) and the
  // capsule fell straight through.
  const tri = makeTriangle([-11000, -0.05, -5000], [-10500, -0.05, -5000], [-10500, -0.05, -5500]);
  const segment = new THREE.Line3(
    new THREE.Vector3(-10903.61, -1, -5044.31),
    new THREE.Vector3(-10903.61, 1, -5044.31)
  );

  const triPoint = new THREE.Vector3();
  const capsulePoint = new THREE.Vector3();
  const { distance, pierced } = closestSegmentTriangleDistance(tri, segment, triPoint, capsulePoint);

  assert.equal(pierced, true);
  assert.ok(distance < 1e-9, `expected ~0 distance, got ${distance}`);
});

test('falls back to the library result when the segment does not pierce the triangle', () => {
  const tri = makeTriangle([0, 0, 0], [10, 0, 0], [0, 0, 10]);
  // Segment well outside the triangle's footprint (x=100), just floating nearby.
  const segment = new THREE.Line3(new THREE.Vector3(100, -1, 100), new THREE.Vector3(100, 1, 100));

  const triPoint = new THREE.Vector3();
  const capsulePoint = new THREE.Vector3();
  const { distance, pierced } = closestSegmentTriangleDistance(tri, segment, triPoint, capsulePoint);

  assert.equal(pierced, false);
  assert.ok(distance > 100, `expected a large distance, got ${distance}`);
});

test('falls back correctly when the segment is near an edge (not piercing)', () => {
  const tri = makeTriangle([0, 0, 0], [10, 0, 0], [0, 0, 10]);
  // Segment just above one edge of the triangle, not crossing through it.
  const segment = new THREE.Line3(new THREE.Vector3(5, 0.1, 0), new THREE.Vector3(5, 2, 0));

  const triPoint = new THREE.Vector3();
  const capsulePoint = new THREE.Vector3();
  const { distance, pierced } = closestSegmentTriangleDistance(tri, segment, triPoint, capsulePoint);

  assert.equal(pierced, false);
  assert.ok(distance < 0.2, `expected a small distance near the edge, got ${distance}`);
});

test('piercedPushDirection points toward the segment start side (feet stay on their current side)', () => {
  const tri = makeTriangle([-10, 0, -10], [10, 0, -10], [-10, 0, 10]); // flat, normal should be +/-Y
  tri.update();

  // start below the plane (y=-1), end above (y=1) -- push should send the
  // capsule further in start's direction (downward, away from the plane)
  // is WRONG; it should push so that start ends up clear on its own side,
  // i.e. away from the plane along whichever normal orientation start
  // already leans toward.
  const segment = new THREE.Line3(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0));
  const dir = piercedPushDirection(tri, segment, new THREE.Vector3());

  const distBefore = tri.plane.distanceToPoint(segment.start);
  const movedPoint = segment.start.clone().addScaledVector(dir, 0.1);
  const distAfter = tri.plane.distanceToPoint(movedPoint);

  assert.ok(Math.abs(distAfter) > Math.abs(distBefore), 'pushing along dir should move start further from the plane, not closer');
});
