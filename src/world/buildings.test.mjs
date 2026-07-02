import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBuildingsGeometry } from './buildings.js';

// buildBuildingsGeometry only needs THREE's BufferGeometry/Float32BufferAttribute,
// both trivially constructible in Node -- no WebGL needed.

test('skips a degenerate (<3-point) ring without throwing', () => {
  const buildings = [{ r: [[0, 0, 10, 0]], h: 5, b: 0 }]; // outer ring has only 2 points
  const geometry = buildBuildingsGeometry(buildings);
  assert.equal(geometry.index.count, 0);
});

test('skips a zero-length edge within an otherwise-valid ring, keeping the rest', () => {
  const outer = [0, 0, 10, 0, 10, 0, 10, 10]; // duplicate point (10,0) creates one zero-length edge
  const buildings = [{ r: [outer], h: 5, b: 0 }];
  const geometry = buildBuildingsGeometry(buildings);
  assert.ok(geometry.index.count > 0, 'the valid edges must still produce wall geometry');
});

test('a valid multi-ring building (with a hole) still gets full wall geometry', () => {
  const outer = [0, 0, 0, 10, 10, 10, 10, 0];
  const hole = [3, 3, 3, 6, 6, 6, 6, 3];
  const buildings = [{ r: [outer, hole], h: 5, b: 0 }];
  const geometry = buildBuildingsGeometry(buildings);
  assert.ok(geometry.index.count > 0);
});
