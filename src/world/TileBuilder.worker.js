// Web Worker: builds tile geometry off the main thread so parsing +
// triangulating + merging never causes a frame hitch. Reuses the exact same
// builder functions the (now removed) main-thread single-tile demo used —
// THREE.BufferGeometry/BufferAttribute are plain data containers with no
// DOM/WebGL dependency, so they're safe to construct here.
import { buildBuildingsGeometry } from './buildings.js';
import { buildWaterGeometry, buildLanduseGeometry } from './areas.js';
import { buildRoadsGeometry, buildRailGeometry } from './roads.js';

function extractLayer(geometry) {
  if (geometry.index.count === 0) return null;

  const position = geometry.attributes.position.array;
  const normal = geometry.attributes.normal.array;
  const color = geometry.attributes.color ? geometry.attributes.color.array : null;
  const index = geometry.index.array;
  const bb = geometry.boundingBox;
  const bs = geometry.boundingSphere;

  return {
    position,
    normal,
    color,
    index,
    boundingBox: { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] },
    boundingSphere: { center: [bs.center.x, bs.center.y, bs.center.z], radius: bs.radius },
  };
}

function transfersFor(layer) {
  if (!layer) return [];
  const buffers = [layer.position.buffer, layer.normal.buffer, layer.index.buffer];
  if (layer.color) buffers.push(layer.color.buffer);
  return buffers;
}

self.onmessage = (event) => {
  const { type, key, tile } = event.data;
  if (type !== 'build') return;

  try {
    const layers = {
      buildings: tile.buildings.length ? extractLayer(buildBuildingsGeometry(tile.buildings)) : null,
      roads: tile.roads.length ? extractLayer(buildRoadsGeometry(tile.roads)) : null,
      water: tile.water.length ? extractLayer(buildWaterGeometry(tile.water)) : null,
      landuse: tile.landuse.length ? extractLayer(buildLanduseGeometry(tile.landuse)) : null,
      rail: tile.rail.length ? extractLayer(buildRailGeometry(tile.rail)) : null,
    };

    const transfer = Object.values(layers).flatMap(transfersFor);
    self.postMessage({ type: 'built', key, layers }, transfer);
  } catch (err) {
    self.postMessage({ type: 'build-error', key, message: err.message });
  }
};
