// Pure 2D spatial helpers shared by the offline population generator and the
// runtime citizen movement (road-following). Works in the flat world XZ plane
// (meters), matching the ENU projection used everywhere else. No THREE, no
// dependencies, so it runs in node:test and in the browser bundle alike.

/**
 * Closest point on a single segment [ax,az]->[bx,bz] to (px,pz).
 * Returns { x, z, t, distSq } where t in [0,1] is the parametric position.
 */
export function closestPointOnSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const x = ax + t * dx;
  const z = az + t * dz;
  const ddx = px - x;
  const ddz = pz - z;
  return { x, z, t, distSq: ddx * ddx + ddz * ddz };
}

/**
 * Nearest point on a set of polylines to (x, z). Each polyline is a flat
 * [x0,z0,x1,z1,...] array (the same shape roads use in tile JSON).
 * Returns { x, z, dist, line, seg } identifying the polyline index and the
 * segment index within it, or null if there are no segments. `line` objects
 * may be either flat arrays or {p:flatArray} — both are accepted so callers
 * can pass tile road entries directly.
 */
export function nearestPointOnPolylines(polylines, x, z) {
  let best = null;
  for (let li = 0; li < polylines.length; li++) {
    const p = polylines[li].p ?? polylines[li];
    for (let i = 0; i + 3 < p.length; i += 2) {
      const c = closestPointOnSegment(x, z, p[i], p[i + 1], p[i + 2], p[i + 3]);
      if (best === null || c.distSq < best.distSq) {
        best = { x: c.x, z: c.z, distSq: c.distSq, line: li, seg: i / 2, t: c.t };
      }
    }
  }
  if (best === null) return null;
  return { x: best.x, z: best.z, dist: Math.sqrt(best.distSq), line: best.line, seg: best.seg, t: best.t };
}

/**
 * Signed area of a ring (array of [x,z] pairs). Positive/negative depending on
 * winding; callers usually want the magnitude via ringArea.
 */
export function signedRingArea(ring) {
  let area = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % n];
    area += x1 * z2 - x2 * z1;
  }
  return area / 2;
}

/** Absolute area of a ring in square meters. */
export function ringArea(ring) {
  return Math.abs(signedRingArea(ring));
}

/**
 * Area-weighted centroid of a ring (array of [x,z]). Falls back to the vertex
 * average for degenerate (near-zero-area) rings so it never returns NaN.
 */
export function centroidOfRing(ring) {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % n];
    const cross = x1 * z2 - x2 * z1;
    a += cross;
    cx += (x1 + x2) * cross;
    cz += (z1 + z2) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sz = 0;
    for (const [x, z] of ring) {
      sx += x;
      sz += z;
    }
    return [sx / ring.length, sz / ring.length];
  }
  return [cx / (6 * a), cz / (6 * a)];
}
