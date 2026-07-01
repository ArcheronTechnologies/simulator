import { tileIndex, tileKey } from '../core/geo.js';

const NEARBY_RADIUS = 1; // 3x3 tiles around the player -- collision cost stays flat regardless of view distance

/**
 * Tracks BVH-accelerated collision meshes: one per streamed tile's buildings
 * layer (added/removed as TileManager streams tiles) plus a static ground
 * plane. Each tile keeps its own small BVH rather than one global merged
 * tree, so streaming never triggers a full-scene rebuild.
 */
export class Collider {
  constructor(tileSize) {
    this.tileSize = tileSize;
    this.tileMeshes = new Map(); // key -> buildings Mesh
    this.groundMesh = null;
  }

  setGround(mesh) {
    mesh.geometry.computeBoundsTree();
    this.groundMesh = mesh;
  }

  addTile(key, buildingsMesh) {
    if (!buildingsMesh) return; // tile had no buildings layer
    buildingsMesh.geometry.computeBoundsTree();
    this.tileMeshes.set(key, buildingsMesh);
  }

  removeTile(key) {
    const mesh = this.tileMeshes.get(key);
    if (!mesh) return;
    mesh.geometry.disposeBoundsTree();
    this.tileMeshes.delete(key);
  }

  /** Colliders relevant near a world position: ground + nearby tiles' buildings. */
  nearbyColliders(x, z) {
    const { tx, tz } = tileIndex(x, z, this.tileSize);
    const meshes = [];
    if (this.groundMesh) meshes.push(this.groundMesh);
    for (let dx = -NEARBY_RADIUS; dx <= NEARBY_RADIUS; dx++) {
      for (let dz = -NEARBY_RADIUS; dz <= NEARBY_RADIUS; dz++) {
        const mesh = this.tileMeshes.get(tileKey(tx + dx, tz + dz));
        if (mesh) meshes.push(mesh);
      }
    }
    return meshes;
  }
}
