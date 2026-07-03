import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBuildingsGeometry } from './buildings.js';

// buildBuildingsGeometry only needs THREE's BufferGeometry/Float32BufferAttribute,
// both trivially constructible in Node -- no WebGL needed.

test('skips a degenerate (<3-point) outer ring without throwing', () => {
  // A 2-point outer ring never reaches the wall loop's own n<3 guard: earcut
  // produces zero cap triangles for it, so buildBuildingsGeometry's upstream
  // `if (nextOffset === vertexOffset) continue;` skips the whole building
  // first (confirmed by direct execution). This test only covers that
  // upstream short-circuit; see the next test for the wall-loop guard itself.
  const buildings = [{ r: [[0, 0, 10, 0]], h: 5, b: 0 }]; // outer ring has only 2 points
  const geometry = buildBuildingsGeometry(buildings);
  assert.equal(geometry.index.count, 0);
});

test('skips wall quads for a degenerate (<3-point) hole ring, while the valid outer ring still caps', () => {
  // The n<3 wall-loop guard is only reachable when the CAP succeeds (a valid
  // outer ring), so the degenerate ring here must be a hole alongside a
  // valid outer -- confirmed by direct execution: with the guard removed,
  // this exact construction produces 8 more vertices (two doubled-back wall
  // quads traced along the degenerate hole's single 2-point edge).
  const outer = [0, 0, 0, 10, 10, 10, 10, 0];
  const degenerateHole = [3, 3, 6, 6]; // 2 points -- not a valid ring
  const buildings = [{ r: [outer, degenerateHole], h: 5, b: 0 }];
  const geometry = buildBuildingsGeometry(buildings);
  // 6 cap vertices (4 outer + 2 hole boundary points earcut still places) +
  // 16 wall vertices (the outer ring's 4 edges) + 0 from the degenerate hole.
  assert.equal(geometry.attributes.position.count, 22, 'the degenerate hole ring must not contribute wall geometry');
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
