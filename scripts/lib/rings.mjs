// Stitches OSM multipolygon relation members into closed rings, and assigns
// inner rings (holes) to the outer ring that contains them.
//
// Overpass returns exact, repeated lat/lon values at nodes shared between
// adjacent ways in a relation (queried with `out geom;`), so a fixed-precision
// string key reliably matches shared endpoints — no distance tolerance needed.

function keyOf(pt) {
  return `${pt[0].toFixed(7)},${pt[1].toFixed(7)}`;
}

function reversed(arr) {
  return arr.slice().reverse();
}

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

      for (let j = 0; j < segments.length; j++) {
        if (used[j]) continue;
        const seg = segments[j];

        if (keyOf(seg[0]) === keyOf(chainEnd)) {
          chain = chain.concat(seg.slice(1));
        } else if (keyOf(seg[seg.length - 1]) === keyOf(chainEnd)) {
          chain = chain.concat(reversed(seg).slice(1));
        } else if (keyOf(seg[seg.length - 1]) === keyOf(chainStart)) {
          chain = seg.slice(0, -1).concat(chain);
        } else if (keyOf(seg[0]) === keyOf(chainStart)) {
          chain = reversed(seg).slice(0, -1).concat(chain);
        } else {
          continue;
        }
        used[j] = true;
        progress = true;
        break;
      }
    }

    if (chain.length >= 4 && keyOf(chain[0]) === keyOf(chain[chain.length - 1])) {
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
    const owner = polygons.find((p) => pointInRing(hole[0], p.outer));
    if (owner) owner.holes.push(hole);
    // else: hole with no containing outer ring — drop it (malformed data).
  }
  return polygons;
}
