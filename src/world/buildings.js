import * as THREE from 'three';
import earcut from 'earcut';

// Shared material: buildings come from OSM ring data whose winding
// direction isn't reliably consistent (mapper-dependent, and further
// scrambled by our lat/lon -> x/z projection), so front-face culling would
// make some walls/caps invisible depending on source data. DoubleSide is a
// small, well-understood fill-rate cost that removes that whole bug class.
export const buildingsMaterial = new THREE.MeshStandardMaterial({
  color: 0x9a8f80,
  roughness: 0.9,
  metalness: 0.0,
  side: THREE.DoubleSide,
});

/**
 * Builds one merged BufferGeometry for every building in a tile: a top cap
 * (earcut-triangulated, holes supported) at y=height, and wall quads per
 * ring edge (outer + holes) from y=base to y=height. No bottom cap — never
 * visible from inside a walkable city.
 *
 * @param {Array<{r: number[][], h: number, b: number}>} buildings - tile.buildings
 * @returns {THREE.BufferGeometry}
 */
export function buildBuildingsGeometry(buildings) {
  const positions = [];
  const indices = [];
  let vertexOffset = 0;

  for (const building of buildings) {
    const rings = building.r; // [outerFlat, ...holeFlats], each [x,z,x,z,...]
    const height = building.h;
    const base = building.b || 0;
    if (height <= base) continue;

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
      continue; // malformed ring — skip this building rather than corrupt the tile mesh
    }
    if (tris.length === 0) continue;

    // --- top cap ---
    const vertCount = flatAll.length / 2;
    for (let i = 0; i < vertCount; i++) {
      positions.push(flatAll[i * 2], height, flatAll[i * 2 + 1]);
    }
    for (let i = 0; i < tris.length; i++) {
      indices.push(vertexOffset + tris[i]);
    }
    vertexOffset += vertCount;

    // --- walls: one quad per edge of every ring (outer + holes) ---
    for (const ring of rings) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x0 = ring[i * 2];
        const z0 = ring[i * 2 + 1];
        const x1 = ring[j * 2];
        const z1 = ring[j * 2 + 1];

        const base0 = vertexOffset;
        positions.push(x0, base, z0);
        positions.push(x1, base, z1);
        positions.push(x1, height, z1);
        positions.push(x0, height, z0);
        indices.push(base0, base0 + 1, base0 + 2, base0, base0 + 2, base0 + 3);
        vertexOffset += 4;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
