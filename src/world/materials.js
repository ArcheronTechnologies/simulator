import * as THREE from 'three';

// One material instance per layer, shared by every tile's mesh for that
// layer. Kept separate from the geometry builders (buildings.js, areas.js,
// roads.js) so those stay import-safe inside the tile-build Web Worker,
// which has no reason to construct rendering materials.

// Buildings come from OSM ring data whose winding direction isn't reliably
// consistent (mapper-dependent, and further scrambled by our lat/lon -> x/z
// projection), so front-face culling would make some walls/caps invisible
// depending on source data. DoubleSide is a small, well-understood
// fill-rate cost that removes that whole bug class.
export const buildingsMaterial = new THREE.MeshStandardMaterial({
  color: 0x9a8f80,
  roughness: 0.9,
  metalness: 0.0,
  side: THREE.DoubleSide,
});

export const waterMaterial = new THREE.MeshStandardMaterial({
  color: 0x3f6f8f,
  roughness: 0.3,
  metalness: 0.1,
  side: THREE.DoubleSide,
});

export const landuseMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 1.0,
  metalness: 0.0,
  side: THREE.DoubleSide,
});

export const roadsMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 1.0,
  metalness: 0.0,
});

export const railMaterial = new THREE.MeshStandardMaterial({
  color: 0x3a3a3a,
  roughness: 0.6,
  metalness: 0.4,
});
