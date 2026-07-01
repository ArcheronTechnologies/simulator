import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleRings, buildMultipolygons, pointInRing } from './rings.mjs';
import { clipPolygonToRect, clipPolylineToRect, boundsOf } from './clip.mjs';

test('assembleRings stitches two ways (one reversed) into a closed square', () => {
  // Square edges: (0,0)-(0,10)-(10,10)-(10,0)-(0,0), split into
  // wayA = (0,0)->(0,10)->(10,10), and the remaining two edges supplied
  // reversed as wayB = (0,0)->(10,0)->(10,10) (i.e. the true path
  // (10,10)->(10,0)->(0,0) written backwards) to exercise the
  // reversed-match stitching branch.
  const wayA = [[0, 0], [0, 10], [10, 10]];
  const wayB = [[0, 0], [10, 0], [10, 10]];
  const rings = assembleRings([wayA, wayB]);
  assert.equal(rings.length, 1);
  const ring = rings[0];
  assert.equal(ring[0][0], ring[ring.length - 1][0]);
  assert.equal(ring[0][1], ring[ring.length - 1][1]);
  // 4 distinct corners + closing repeat = 5
  assert.equal(ring.length, 5);
});

test('assembleRings drops ways that cannot close', () => {
  const openWay = [[0, 0], [0, 10], [10, 10]]; // no matching partner
  const rings = assembleRings([openWay]);
  assert.equal(rings.length, 0);
});

test('buildMultipolygons assigns an inner ring to its containing outer ring', () => {
  const outer = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
  const inner = [[3, 3], [3, 6], [6, 6], [6, 3], [3, 3]];
  const polys = buildMultipolygons([
    { role: 'outer', geometry: outer },
    { role: 'inner', geometry: inner },
  ]);
  assert.equal(polys.length, 1);
  assert.equal(polys[0].holes.length, 1);
});

test('pointInRing ray casting basic sanity', () => {
  const square = [[0, 0], [0, 10], [10, 10], [10, 0]];
  assert.equal(pointInRing([5, 5], square), true);
  assert.equal(pointInRing([15, 5], square), false);
});

test('clipPolygonToRect clips a corner off a square', () => {
  // 10x10 square clipped to the [0,5]x[0,5] rect -> should yield the 5x5 sub-square
  const square = [[0, 0], [0, 10], [10, 10], [10, 0]];
  const rect = { minX: 0, minZ: 0, maxX: 5, maxZ: 5 };
  const clipped = clipPolygonToRect(square, rect);
  const b = boundsOf(clipped);
  assert.equal(b.minX, 0);
  assert.equal(b.minZ, 0);
  assert.equal(b.maxX, 5);
  assert.equal(b.maxZ, 5);
});

test('clipPolygonToRect returns empty for a polygon entirely outside the rect', () => {
  const square = [[100, 100], [100, 110], [110, 110], [110, 100]];
  const rect = { minX: 0, minZ: 0, maxX: 5, maxZ: 5 };
  assert.equal(clipPolygonToRect(square, rect).length, 0);
});

test('clipPolylineToRect splits a line that exits and re-enters the rect', () => {
  // Line goes from inside -> outside -> inside again across the [0,10] box
  const line = [
    [5, 5],
    [15, 5], // exits at x=10
    [15, 8],
    [5, 8], // re-enters at x=10
  ];
  const rect = { minX: 0, minZ: 0, maxX: 10, maxZ: 10 };
  const segments = clipPolylineToRect(line, rect);
  assert.equal(segments.length, 2);
  for (const seg of segments) {
    for (const [x] of seg) {
      assert.ok(x <= 10.0001, `x=${x} should be clipped to <=10`);
    }
  }
});

test('clipPolylineToRect returns nothing for a line entirely outside', () => {
  const line = [[100, 100], [110, 110]];
  const rect = { minX: 0, minZ: 0, maxX: 10, maxZ: 10 };
  assert.equal(clipPolylineToRect(line, rect).length, 0);
});
