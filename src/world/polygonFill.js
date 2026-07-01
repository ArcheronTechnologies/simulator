import earcut from 'earcut';

/**
 * Triangulates a set of rings (outer + holes, each flat [x,z,x,z,...]) into
 * a flat cap at height `y`, appending into the given position/index arrays.
 * Shared by buildings (top cap), water, and landuse (flat fills).
 *
 * @returns {number} the new vertex offset (positions.length / 3)
 */
export function appendPolygonCap(rings, y, positions, indices, vertexOffset) {
  const holeIndices = [];
  const flatAll = [];
  let running = 0;
  for (const ring of rings) {
    if (running > 0) holeIndices.push(running);
    for (let i = 0; i < ring.length; i++) flatAll.push(ring[i]);
    running += ring.length / 2;
  }

  let tris;
  try {
    tris = earcut(flatAll, holeIndices.length ? holeIndices : null, 2);
  } catch {
    return vertexOffset; // malformed ring — skip rather than corrupt the tile mesh
  }
  if (tris.length === 0) return vertexOffset;

  const vertCount = flatAll.length / 2;
  for (let i = 0; i < vertCount; i++) {
    positions.push(flatAll[i * 2], y, flatAll[i * 2 + 1]);
  }
  for (let i = 0; i < tris.length; i++) {
    indices.push(vertexOffset + tris[i]);
  }
  return vertexOffset + vertCount;
}
