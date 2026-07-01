import * as THREE from 'three';
import { appendPolygonCap } from './polygonFill.js';

// Small y-offsets keep flat area fills from z-fighting with the ground
// plane and with each other where landuse and water happen to overlap.
const WATER_Y = 0.02;
const LANDUSE_Y = 0.01;

// Visual variety by landuse/leisure type enum (see osm_to_tiles.mjs).
const LANDUSE_COLORS = {
  0: 0x4f7a3d, // park
  1: 0x5c8a4a, // garden
  2: 0x5a9c5a, // pitch
  3: 0x8a9a6a, // playground
  4: 0x2f5530, // forest/wood
  5: 0x6b6455, // residential landuse
  6: 0x726a5e, // commercial/industrial/retail
  7: 0x9a9560, // farmland/farmyard/meadow/grass
  8: 0x77836f, // cemetery
  9: 0x707060, // default
};
const DEFAULT_LANDUSE_COLOR = 0x707060;

/** @param {Array<{r: number[][]}>} water - tile.water */
export function buildWaterGeometry(water) {
  const positions = [];
  const indices = [];
  let vertexOffset = 0;

  for (const area of water) {
    vertexOffset = appendPolygonCap(area.r, WATER_Y, positions, indices, vertexOffset);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** @param {Array<{t: number, r: number[][]}>} landuse - tile.landuse */
export function buildLanduseGeometry(landuse) {
  const positions = [];
  const colors = [];
  const indices = [];
  let vertexOffset = 0;

  for (const area of landuse) {
    const nextOffset = appendPolygonCap(area.r, LANDUSE_Y, positions, indices, vertexOffset);
    const color = LANDUSE_COLORS[area.t] ?? DEFAULT_LANDUSE_COLOR;
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    for (let i = vertexOffset; i < nextOffset; i++) colors.push(r, g, b);
    vertexOffset = nextOffset;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
