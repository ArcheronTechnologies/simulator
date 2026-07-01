import * as THREE from 'three';

// Sits just above landuse/water so roads consistently read as "on top".
const ROAD_Y = 0.03;
const RAIL_Y = 0.04; // fractionally above roads so level crossings read correctly

// Real-world-typical widths in meters by class enum (see osm_to_tiles.mjs).
const ROAD_WIDTHS_M = {
  0: 12, // motorway/trunk
  1: 11, // primary
  2: 9, // secondary
  3: 7, // tertiary
  4: 6, // residential/unclassified/living_street
  5: 4, // service
  6: 2, // footway/path/pedestrian/steps/platform/track
  7: 2.5, // cycleway
};
const DEFAULT_ROAD_WIDTH_M = 5;

const ROAD_COLORS = {
  0: 0x4a4a4a,
  1: 0x555555,
  2: 0x5c5c5c,
  3: 0x666666,
  4: 0x707070,
  5: 0x787060,
  6: 0xb8ac93,
  7: 0x8a6d4f,
};
const DEFAULT_ROAD_COLOR = 0x707070;

const RAIL_WIDTH_M = 1.5; // rails + ties, not the wider ballast bed

/**
 * Appends one ribbon quad per polyline segment (no miter joins at bends —
 * acceptable at street width/curvature for a POC) into shared buffers.
 */
function appendRibbon(points, halfWidth, y, r, g, b, positions, colors, indices, vertexOffset) {
  const n = points.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const x0 = points[i * 2];
    const z0 = points[i * 2 + 1];
    const x1 = points[(i + 1) * 2];
    const z1 = points[(i + 1) * 2 + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue; // degenerate zero-length segment

    const nx = (-dz / len) * halfWidth;
    const nz = (dx / len) * halfWidth;

    const base = vertexOffset;
    positions.push(x0 - nx, y, z0 - nz);
    positions.push(x0 + nx, y, z0 + nz);
    positions.push(x1 + nx, y, z1 + nz);
    positions.push(x1 - nx, y, z1 - nz);
    if (colors) for (let k = 0; k < 4; k++) colors.push(r, g, b);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    vertexOffset += 4;
  }
  return vertexOffset;
}

/** @param {Array<{c: number, p: number[]}>} roads - tile.roads */
export function buildRoadsGeometry(roads) {
  const positions = [];
  const colors = [];
  const indices = [];
  let vertexOffset = 0;

  for (const road of roads) {
    if (road.p.length / 2 < 2) continue;
    const halfWidth = (ROAD_WIDTHS_M[road.c] ?? DEFAULT_ROAD_WIDTH_M) / 2;
    const color = ROAD_COLORS[road.c] ?? DEFAULT_ROAD_COLOR;
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    vertexOffset = appendRibbon(road.p, halfWidth, ROAD_Y, r, g, b, positions, colors, indices, vertexOffset);
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

/** @param {Array<{p: number[]}>} rail - tile.rail */
export function buildRailGeometry(rail) {
  const positions = [];
  const indices = [];
  let vertexOffset = 0;

  for (const track of rail) {
    if (track.p.length / 2 < 2) continue;
    vertexOffset = appendRibbon(track.p, RAIL_WIDTH_M / 2, RAIL_Y, 0, 0, 0, positions, null, indices, vertexOffset);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
