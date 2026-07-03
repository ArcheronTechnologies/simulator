// Converts raw Overpass JSON elements into compact, pre-projected per-tile
// feature files. Runs offline (Node), never at runtime in the browser.
import { buildMultipolygons } from './rings.mjs';
import { clipPolygonToRect, clipPolylineToRect, boundsOf } from './clip.mjs';

const ROAD_CLASSES = {
  motorway: 0, motorway_link: 0,
  trunk: 0, trunk_link: 0,
  primary: 1, primary_link: 1,
  secondary: 2, secondary_link: 2,
  tertiary: 3, tertiary_link: 3,
  residential: 4, living_street: 4, unclassified: 4,
  service: 5,
  footway: 6, path: 6, pedestrian: 6, steps: 6, platform: 6, elevator: 6, track: 6,
  cycleway: 7,
};
const DEFAULT_ROAD_CLASS = 4;

const PARK_LEISURE = new Set(['park', 'garden', 'pitch', 'playground', 'nature_reserve']);
const NATURAL_AREAS = new Set(['wood', 'scrub', 'heath', 'grassland', 'wetland', 'beach']);

const LANDUSE_TYPES = {
  park: 0, garden: 1, pitch: 2, playground: 3, nature_reserve: 0,
  forest: 4, wood: 4, scrub: 4,
  residential: 5,
  commercial: 6, industrial: 6, retail: 6,
  farmland: 7, farmyard: 7, meadow: 7, grass: 7, grassland: 7, heath: 7,
  cemetery: 8,
  wetland: 10,
  beach: 11,
};
const DEFAULT_LANDUSE_TYPE = 9;

function roadClassOf(highwayTag) {
  return ROAD_CLASSES[highwayTag] ?? DEFAULT_ROAD_CLASS;
}

function landuseTypeOf(tags) {
  const key = tags.landuse || tags.leisure || tags.natural;
  return LANDUSE_TYPES[key] ?? DEFAULT_LANDUSE_TYPE;
}

function isParkLeisure(leisure) {
  return leisure != null && PARK_LEISURE.has(leisure);
}

function isNaturalArea(natural) {
  return natural != null && NATURAL_AREAS.has(natural);
}

function heightForBuilding(tags, levelHeightM, typeHeights) {
  if (tags.height) {
    const h = parseFloat(tags.height);
    if (!Number.isNaN(h)) return h;
  }
  if (tags['building:levels']) {
    const levels = parseFloat(tags['building:levels']);
    if (!Number.isNaN(levels)) {
      let h = levels * levelHeightM;
      const roofLevels = parseFloat(tags['roof:levels']);
      if (!Number.isNaN(roofLevels)) h += roofLevels * levelHeightM;
      return h;
    }
  }
  const type = tags.building;
  return typeHeights[type] ?? typeHeights.default;
}

function baseForBuilding(tags, levelHeightM) {
  if (tags.min_height) {
    const b = parseFloat(tags.min_height);
    if (!Number.isNaN(b)) return b;
  }
  if (tags['building:min_level']) {
    const lv = parseFloat(tags['building:min_level']);
    if (!Number.isNaN(lv)) return lv * levelHeightM;
  }
  return 0;
}

function dedupeClosingPoint(ring) {
  if (
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  ) {
    return ring.slice(0, -1);
  }
  return ring;
}

function toLatLonTuples(geometry) {
  return geometry.map((pt) => [pt.lat, pt.lon]);
}

/**
 * Converts raw Overpass elements (from `out geom;`) into projected feature
 * lists, keyed by layer. `project(lat, lon) -> {x, z}` is the shared ENU
 * projection from src/core/geo.js so pipeline output aligns with runtime.
 */
export function convertToFeatures(elements, { project, levelHeightM, typeHeights }) {
  const buildings = [];
  const roads = [];
  const water = [];
  const landuse = [];
  const rail = [];

  const projectRing = (ring) => dedupeClosingPoint(ring).map(([lat, lon]) => {
    const { x, z } = project(lat, lon);
    return [x, z];
  });
  const projectLine = (geometry) => geometry.map((pt) => {
    const { x, z } = project(pt.lat, pt.lon);
    return [x, z];
  });

  for (const el of elements) {
    const tags = el.tags || {};

    if (el.type === 'way' && tags.building && el.geometry?.length >= 4) {
      const ring = toLatLonTuples(el.geometry);
      buildings.push({
        outer: projectRing(ring),
        holes: [],
        height: heightForBuilding(tags, levelHeightM, typeHeights),
        base: baseForBuilding(tags, levelHeightM),
      });
      continue;
    }

    if (el.type === 'relation' && tags.building && tags.type === 'multipolygon' && el.members) {
      const members = el.members
        .filter((m) => m.type === 'way' && m.geometry)
        .map((m) => ({ role: m.role, geometry: toLatLonTuples(m.geometry) }));
      for (const poly of buildMultipolygons(members)) {
        buildings.push({
          outer: projectRing(poly.outer),
          holes: poly.holes.map((h) => projectRing(h)),
          height: heightForBuilding(tags, levelHeightM, typeHeights),
          base: baseForBuilding(tags, levelHeightM),
        });
      }
      continue;
    }

    if (el.type === 'way' && tags.highway && el.geometry?.length >= 2) {
      roads.push({ cls: roadClassOf(tags.highway), name: tags.name || null, points: projectLine(el.geometry) });
      continue;
    }

    if (el.type === 'way' && tags.railway && el.geometry?.length >= 2) {
      rail.push({ points: projectLine(el.geometry) });
      continue;
    }

    if (el.type === 'way' && tags.natural === 'water' && el.geometry?.length >= 4) {
      water.push({ outer: projectRing(toLatLonTuples(el.geometry)), holes: [] });
      continue;
    }
    if (
      el.type === 'relation' &&
      tags.natural === 'water' &&
      tags.type === 'multipolygon' &&
      el.members
    ) {
      const members = el.members
        .filter((m) => m.type === 'way' && m.geometry)
        .map((m) => ({ role: m.role, geometry: toLatLonTuples(m.geometry) }));
      for (const poly of buildMultipolygons(members)) {
        water.push({ outer: projectRing(poly.outer), holes: poly.holes.map((h) => projectRing(h)) });
      }
      continue;
    }

    const isLanduseArea = tags.landuse || isParkLeisure(tags.leisure) || isNaturalArea(tags.natural);
    if (el.type === 'way' && isLanduseArea && el.geometry?.length >= 4) {
      landuse.push({ type: landuseTypeOf(tags), outer: projectRing(toLatLonTuples(el.geometry)), holes: [] });
      continue;
    }
    if (el.type === 'relation' && isLanduseArea && tags.type === 'multipolygon' && el.members) {
      const members = el.members
        .filter((m) => m.type === 'way' && m.geometry)
        .map((m) => ({ role: m.role, geometry: toLatLonTuples(m.geometry) }));
      for (const poly of buildMultipolygons(members)) {
        landuse.push({
          type: landuseTypeOf(tags),
          outer: projectRing(poly.outer),
          holes: poly.holes.map((h) => projectRing(h)),
        });
      }
      continue;
    }
  }

  return { buildings, roads, water, landuse, rail };
}

function tileRect(tx, tz, tileSizeM) {
  return { minX: tx * tileSizeM, minZ: tz * tileSizeM, maxX: (tx + 1) * tileSizeM, maxZ: (tz + 1) * tileSizeM };
}

function overlappingTileRange(bbox, tileSizeM) {
  return {
    minTx: Math.floor(bbox.minX / tileSizeM),
    maxTx: Math.floor(bbox.maxX / tileSizeM),
    minTz: Math.floor(bbox.minZ / tileSizeM),
    maxTz: Math.floor(bbox.maxZ / tileSizeM),
  };
}

function round(n) {
  return Math.round(n * 100) / 100; // centimeter precision
}

function flattenRing(ring) {
  const flat = [];
  for (const [x, z] of ring) {
    flat.push(round(x), round(z));
  }
  return flat;
}

function getOrCreateTile(tilesMap, tx, tz) {
  const key = `${tx}_${tz}`;
  let tile = tilesMap.get(key);
  if (!tile) {
    tile = { buildings: [], roads: [], water: [], landuse: [], rail: [] };
    tilesMap.set(key, tile);
  }
  return tile;
}

function addPolygonToTiles(tilesMap, tileSizeM, polygon, toEntry) {
  const bbox = boundsOf(polygon.outer);
  const { minTx, maxTx, minTz, maxTz } = overlappingTileRange(bbox, tileSizeM);

  if (minTx === maxTx && minTz === maxTz) {
    const tile = getOrCreateTile(tilesMap, minTx, minTz);
    tile[polygon.layer].push(toEntry(polygon, [polygon.outer, ...polygon.holes]));
    return;
  }

  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let tz = minTz; tz <= maxTz; tz++) {
      const rect = tileRect(tx, tz, tileSizeM);
      const clippedOuter = clipPolygonToRect(polygon.outer, rect);
      if (clippedOuter.length < 3) continue;
      const clippedHoles = polygon.holes.map((h) => clipPolygonToRect(h, rect)).filter((h) => h.length >= 3);
      const tile = getOrCreateTile(tilesMap, tx, tz);
      tile[polygon.layer].push(toEntry(polygon, [clippedOuter, ...clippedHoles]));
    }
  }
}

function addPolylineToTiles(tilesMap, tileSizeM, feature, toEntry) {
  const bbox = boundsOf(feature.points);
  const { minTx, maxTx, minTz, maxTz } = overlappingTileRange(bbox, tileSizeM);

  if (minTx === maxTx && minTz === maxTz) {
    const tile = getOrCreateTile(tilesMap, minTx, minTz);
    tile[feature.layer].push(toEntry(feature, feature.points));
    return;
  }

  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let tz = minTz; tz <= maxTz; tz++) {
      const rect = tileRect(tx, tz, tileSizeM);
      const segments = clipPolylineToRect(feature.points, rect);
      if (segments.length === 0) continue;
      const tile = getOrCreateTile(tilesMap, tx, tz);
      for (const seg of segments) {
        tile[feature.layer].push(toEntry(feature, seg));
      }
    }
  }
}

/**
 * Splits projected features across the 500m tile grid, clipping anything
 * that straddles a tile boundary so no tile duplicates or drops geometry.
 * Returns a Map<"tx_tz", tileData>.
 */
export function tileFeatures(features, tileSizeM) {
  const tilesMap = new Map();

  for (const b of features.buildings) {
    addPolygonToTiles(tilesMap, tileSizeM, { ...b, layer: 'buildings' }, (poly, rings) => ({
      r: rings.map(flattenRing),
      h: round(poly.height),
      b: round(poly.base),
    }));
  }
  for (const w of features.water) {
    addPolygonToTiles(tilesMap, tileSizeM, { ...w, layer: 'water' }, (poly, rings) => ({
      r: rings.map(flattenRing),
    }));
  }
  for (const l of features.landuse) {
    addPolygonToTiles(tilesMap, tileSizeM, { ...l, layer: 'landuse' }, (poly, rings) => ({
      t: poly.type,
      r: rings.map(flattenRing),
    }));
  }
  for (const r of features.roads) {
    addPolylineToTiles(tilesMap, tileSizeM, { ...r, layer: 'roads' }, (feat, pts) => ({
      c: feat.cls,
      ...(feat.name ? { n: feat.name } : {}),
      p: pts.flatMap(([x, z]) => [round(x), round(z)]),
    }));
  }
  for (const r of features.rail) {
    addPolylineToTiles(tilesMap, tileSizeM, { ...r, layer: 'rail' }, (feat, pts) => ({
      p: pts.flatMap(([x, z]) => [round(x), round(z)]),
    }));
  }

  return tilesMap;
}

/** Builds the manifest summarizing which tiles have data (non-empty only). */
export function buildManifest(tilesMap, { origin, tileSizeM, mode }) {
  const tiles = {};
  let minTx = Infinity, maxTx = -Infinity, minTz = Infinity, maxTz = -Infinity;

  for (const [key, tile] of tilesMap) {
    const [tx, tz] = key.split('_').map(Number);
    tiles[key] = {
      b: tile.buildings.length,
      r: tile.roads.length,
      w: tile.water.length,
      l: tile.landuse.length,
      rail: tile.rail.length,
    };
    if (tx < minTx) minTx = tx;
    if (tx > maxTx) maxTx = tx;
    if (tz < minTz) minTz = tz;
    if (tz > maxTz) maxTz = tz;
  }

  return {
    origin,
    tileSize: tileSizeM,
    bounds: tilesMap.size > 0 ? { minTx, maxTx, minTz, maxTz } : null,
    tileCount: tilesMap.size,
    // Which fetch produced this manifest ('core' | 'all'), so downstream
    // consumers (generate_population.mjs) can tell whether tile membership
    // alone means "core" or covers the whole municipality. Absent on
    // manifests written before this field existed -- treat that as unknown,
    // not as either mode.
    generatedMode: mode,
    tiles,
  };
}
