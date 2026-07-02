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

// A square P-Q-R-S-P (as a single multi-point way covering Q->R->S->P) plus
// a direct P-Q "shortcut" edge duplicating part of the boundary, so Q is a
// 3-way junction: naive first-array-order matching can pick the shortcut
// right after leaving P, closing a degenerate 3-point non-ring (P,Q,P) and
// permanently consuming the P-Q edge instead of continuing around the real
// square. (Confirmed against the pre-fix algorithm: it returns 0 rings for
// 2 of these 3 orderings; the fix returns the correct 1-ring square for all 3.)
const P = [0, 0], Q = [20, 0], R = [20, 20], S = [0, 20];
const wayPQ = [P, Q];
const shortcut = [Q, P];
const wayRest = [Q, R, S, P]; // single way covering the rest of the boundary

function assertIsTheSquare(rings) {
  assert.equal(rings.length, 1, 'only the real square should assemble; the lone shortcut cannot close by itself');
  assert.equal(rings[0].length, 5);
  assert.ok(rings[0].some((pt) => pt[0] === 20 && pt[1] === 20), 'ring must include R -- a shortcut-only closure would skip it');
}

test('assembleRings prefers extending the chain over closing a too-small ring at a 3-way junction', () => {
  assertIsTheSquare(assembleRings([wayPQ, shortcut, wayRest]));
});

test('assembleRings resolves the same junction with the shortcut first in the array', () => {
  assertIsTheSquare(assembleRings([shortcut, wayPQ, wayRest]));
});

test('assembleRings resolves the same junction with the shortcut last in the array', () => {
  assertIsTheSquare(assembleRings([wayPQ, wayRest, shortcut]));
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

test('buildMultipolygons keeps a concave hole whose centroid falls outside its own footprint', () => {
  // Real coordinates from a Lund OSM building (relation 1954665): a small
  // concave inner ring whose area-weighted centroid lands just outside the
  // hole itself (confirmed: a centroid-only test drops this hole even
  // though hole[0] correctly identifies it as contained -- pointInRing must
  // try both, not replace one single-point heuristic with another).
  const outer = [[55.706718, 13.1962299], [55.7067921, 13.1962743], [55.7069403, 13.1963686], [55.7069087, 13.1965258], [55.7068858, 13.1966394], [55.7068701, 13.1967175], [55.7068579, 13.1967109], [55.7068487, 13.1967542], [55.7067918, 13.1967139], [55.7067485, 13.1967117], [55.7067292, 13.1966829], [55.7066965, 13.196658], [55.7066729, 13.1966343], [55.7066804, 13.1965982], [55.7066521, 13.1965726], [55.7066725, 13.1964665], [55.706718, 13.1962299]];
  const inner = [[55.7068411, 13.1964216], [55.7067182, 13.1963442], [55.7067104, 13.1963864], [55.7067755, 13.1964237], [55.7067593, 13.1965043], [55.7068156, 13.1965429], [55.7068411, 13.1964216]];
  const polys = buildMultipolygons([
    { role: 'outer', geometry: outer },
    { role: 'inner', geometry: inner },
  ]);
  assert.equal(polys.length, 1);
  assert.equal(polys[0].holes.length, 1, 'concave hole must still be kept via the hole[0] fallback');
});

test('pointInRing ray casting basic sanity', () => {
  const square = [[0, 0], [0, 10], [10, 10], [10, 0]];
  assert.equal(pointInRing([5, 5], square), true);
  assert.equal(pointInRing([15, 5], square), false);
});

test('buildMultipolygons keeps a hole whose first vertex sits exactly on the outer ring edge', () => {
  const outer = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
  // Hole's first vertex (0,5) sits exactly on the outer ring's left edge --
  // the old hole[0]-based test is ambiguous there (ray-casting boundary
  // asymmetry); the hole's centroid is safely interior.
  const inner = [[0, 5], [3, 6], [3, 4], [0, 5]];
  const polys = buildMultipolygons([
    { role: 'outer', geometry: outer },
    { role: 'inner', geometry: inner },
  ]);
  assert.equal(polys.length, 1);
  assert.equal(polys[0].holes.length, 1, 'hole touching the boundary at its first vertex must still be assigned');
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
