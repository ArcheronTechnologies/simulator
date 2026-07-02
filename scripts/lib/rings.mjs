// Stitches OSM multipolygon relation members into closed rings, and assigns
// inner rings (holes) to the outer ring that contains them.
//
// Overpass returns exact, repeated lat/lon values at nodes shared between
// adjacent ways in a relation (queried with `out geom;`), so a fixed-precision
// string key reliably matches shared endpoints — no distance tolerance needed.
import { centroidOfRing } from './spatial.mjs';

function keyOf(pt) {
  return `${pt[0].toFixed(7)},${pt[1].toFixed(7)}`;
}

function reversed(arr) {
  return arr.slice().reverse();
}

const MIN_RING_POINTS = 4; // a valid ring needs >=3 distinct vertices + the closing repeat

/**
 * @param {Array<Array<[number, number]>>} ways - way geometries as [lat,lon] tuples
 * @returns {Array<Array<[number, number]>>} closed rings (first point repeated as last)
 */
export function assembleRings(ways) {
  const segments = ways.filter((w) => w.length >= 2);
  const used = new Array(segments.length).fill(false);
  const rings = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = segments[i].slice();

    let progress = true;
    while (progress && keyOf(chain[0]) !== keyOf(chain[chain.length - 1])) {
      progress = false;
      const chainStart = chain[0];
      const chainEnd = chain[chain.length - 1];

      // At a 3+-way junction more than one unused segment can extend the
      // chain. Blindly taking the first array-order match can pick a
      // candidate that immediately closes the chain into a
      // structurally-impossible too-small ring (fewer than MIN_RING_POINTS --
      // it would be dropped by the length check below anyway) while
      // consuming a segment a real, larger ring actually needed. Skip only
      // that specific degenerate case in favor of the next candidate;
      // otherwise keep the original first-match array order. Still
      // O(segments) per step -- no backtracking.
      let bestJ = -1;
      let bestChain = null;
      let bestDegenerate = false;
      for (let j = 0; j < segments.length; j++) {
        if (used[j]) continue;
        const seg = segments[j];
        let next = null;

        if (keyOf(seg[0]) === keyOf(chainEnd)) {
          next = chain.concat(seg.slice(1));
        } else if (keyOf(seg[seg.length - 1]) === keyOf(chainEnd)) {
          next = chain.concat(reversed(seg).slice(1));
        } else if (keyOf(seg[seg.length - 1]) === keyOf(chainStart)) {
          next = seg.slice(0, -1).concat(chain);
        } else if (keyOf(seg[0]) === keyOf(chainStart)) {
          next = reversed(seg).slice(0, -1).concat(chain);
        } else {
          continue;
        }

        const degenerate = keyOf(next[0]) === keyOf(next[next.length - 1]) && next.length < MIN_RING_POINTS;
        if (bestJ === -1) {
          bestJ = j;
          bestChain = next;
          bestDegenerate = degenerate;
          if (!degenerate) break;
        } else if (bestDegenerate && !degenerate) {
          bestJ = j;
          bestChain = next;
          bestDegenerate = false;
          break;
        }
      }

      if (bestJ !== -1) {
        used[bestJ] = true;
        chain = bestChain;
        progress = true;
      }
    }

    if (chain.length >= MIN_RING_POINTS && keyOf(chain[0]) === keyOf(chain[chain.length - 1])) {
      rings.push(chain);
    }
    // else: couldn't close — malformed multipolygon data, drop it.
  }

  return rings;
}

/** Ray-casting point-in-polygon test. `ring` and `pt` are [a,b] tuples. */
export function pointInRing(pt, ring) {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Groups outer/inner rings from a multipolygon relation's members into
 * polygons (one per outer ring, holes assigned by containment).
 * @param {Array<{role: string, geometry: Array<[number,number]>}>} members
 * @returns {Array<{outer: Array, holes: Array<Array>}>}
 */
export function buildMultipolygons(members) {
  const outerWays = members.filter((m) => m.role !== 'inner').map((m) => m.geometry);
  const innerWays = members.filter((m) => m.role === 'inner').map((m) => m.geometry);

  const outerRings = assembleRings(outerWays);
  const innerRings = assembleRings(innerWays);

  const polygons = outerRings.map((outer) => ({ outer, holes: [] }));
  for (const hole of innerRings) {
    // Try both hole[0] and the centroid, accepting either as a match.
    // pointInRing's ray-casting is edge-asymmetric, and a hole's first
    // vertex is often exactly on a shared boundary node with its outer ring
    // -- the centroid alone rescues that case, but is only guaranteed
    // interior for CONVEX holes; a concave hole's centroid can itself land
    // outside (confirmed against real Lund building data). hole[0] alone
    // already handles most real cases correctly, including many concave
    // ones, so trying it first and falling back to the centroid is strictly
    // more robust than either single point alone.
    const owner = polygons.find((p) => pointInRing(hole[0], p.outer) || pointInRing(centroidOfRing(hole), p.outer));
    if (owner) owner.holes.push(hole);
    // else: hole with no containing outer ring — drop it (malformed data).
  }
  return polygons;
}
