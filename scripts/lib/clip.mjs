// Clips projected geometry ([x,z] tuples, meters) against axis-aligned tile
// rectangles. Necessary so streamed tiles never duplicate a feature that
// straddles a tile boundary (z-fighting) or drop the parts of a road that
// fall outside its "home" tile (disconnected streets).

/** Sutherland-Hodgman polygon clip. `ring` is open (no repeated last point). */
export function clipPolygonToRect(ring, rect) {
  let pts = ring;
  if (
    pts.length > 1 &&
    pts[0][0] === pts[pts.length - 1][0] &&
    pts[0][1] === pts[pts.length - 1][1]
  ) {
    pts = pts.slice(0, -1);
  }

  const { minX, minZ, maxX, maxZ } = rect;
  const planes = [
    { inside: (p) => p[0] >= minX, intersect: (a, b) => lerpX(a, b, minX) },
    { inside: (p) => p[0] <= maxX, intersect: (a, b) => lerpX(a, b, maxX) },
    { inside: (p) => p[1] >= minZ, intersect: (a, b) => lerpZ(a, b, minZ) },
    { inside: (p) => p[1] <= maxZ, intersect: (a, b) => lerpZ(a, b, maxZ) },
  ];

  for (const plane of planes) {
    pts = clipAgainstPlane(pts, plane.inside, plane.intersect);
    if (pts.length === 0) return [];
  }
  return pts;
}

function clipAgainstPlane(points, inside, intersect) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const prev = points[(i - 1 + points.length) % points.length];
    const currIn = inside(curr);
    const prevIn = inside(prev);
    if (currIn) {
      if (!prevIn) out.push(intersect(prev, curr));
      out.push(curr);
    } else if (prevIn) {
      out.push(intersect(prev, curr));
    }
  }
  return out;
}

function lerpX(a, b, x) {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}

function lerpZ(a, b, z) {
  const t = (z - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), z];
}

/**
 * Clips an open polyline against an axis-aligned rectangle using per-segment
 * Liang-Barsky clipping. Returns an array of polylines since a line may
 * exit and re-enter the rectangle multiple times.
 */
export function clipPolylineToRect(points, rect) {
  const { minX, minZ, maxX, maxZ } = rect;
  const results = [];
  let current = [];

  for (let i = 0; i < points.length - 1; i++) {
    const clipped = clipSegmentLiangBarsky(points[i], points[i + 1], minX, minZ, maxX, maxZ);
    if (!clipped) {
      if (current.length > 1) results.push(current);
      current = [];
      continue;
    }
    const [ca, cb] = clipped;
    if (current.length === 0) {
      current.push(ca);
    } else {
      const last = current[current.length - 1];
      if (last[0] !== ca[0] || last[1] !== ca[1]) {
        if (current.length > 1) results.push(current);
        current = [ca];
      }
    }
    current.push(cb);
  }
  if (current.length > 1) results.push(current);
  return results;
}

function clipSegmentLiangBarsky(a, b, minX, minZ, maxX, maxZ) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const checks = [
    [-dx, a[0] - minX],
    [dx, maxX - a[0]],
    [-dz, a[1] - minZ],
    [dz, maxZ - a[1]],
  ];

  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null; // parallel to this edge and outside it
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }

  return [
    [a[0] + t0 * dx, a[1] + t0 * dz],
    [a[0] + t1 * dx, a[1] + t1 * dz],
  ];
}

/** Bounding box of a flat [x,z] tuple array, as tile-rect-compatible fields. */
export function boundsOf(points) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}
