#!/usr/bin/env node
// Fetches OSM data for Lund from Overpass (gridded into cells, cached,
// resumable) and converts it into per-tile JSON files under public/tiles/.
//
// Usage: node scripts/fetch_overpass.mjs --core   (small central area)
//        node scripts/fetch_overpass.mjs --all    (whole municipality)
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convertToFeatures, tileFeatures, buildManifest } from './lib/osm_to_tiles.mjs';
import {
  projection,
  ORIGIN,
  LUND_BBOX,
  TILE_SIZE_M,
  LEVEL_HEIGHT_M,
  BUILDING_TYPE_HEIGHTS_M,
  SPAWN_LATLON,
} from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'cache', 'overpass');
const TILES_OUT_DIR = path.join(ROOT, 'public', 'tiles');

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

const METERS_PER_DEG_LAT = 111320;

function metersPerDegLon(lat) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

function overpassQuery(bbox) {
  const b = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  return `
[out:json][timeout:180];
(
  way["building"](${b});
  relation["building"]["type"="multipolygon"](${b});
  way["highway"](${b});
  way["railway"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"]["type"="multipolygon"](${b});
  way["landuse"](${b});
  relation["landuse"]["type"="multipolygon"](${b});
  way["leisure"~"^(park|garden|pitch|playground|nature_reserve)$"](${b});
  relation["leisure"~"^(park|garden|pitch|playground|nature_reserve)$"]["type"="multipolygon"](${b});
);
out geom;
`.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCell(bbox, cellId) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `${cellId}.json`);
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    return cached.elements;
  }

  const query = overpassQuery(bbox);
  let lastErr;
  let tentativeEmpty = null;
  const maxAttempts = MIRRORS.length * 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const mirror = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'lund-walkable-simulation/0.1 (research/hobby project)',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (res.status === 429 || res.status === 504) {
        lastErr = new Error(`HTTP ${res.status} from ${mirror}`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} from ${mirror}: ${text.slice(0, 300)}`);
      }

      const json = await res.json();

      // Overpass occasionally returns HTTP 200 with a valid-but-empty result
      // under load, even for a bbox known to have data. Don't trust a single
      // empty response — retry against another mirror before accepting it
      // (genuinely empty rural cells still succeed once attempts run out).
      if (json.elements.length === 0 && attempt < maxAttempts - 1) {
        tentativeEmpty = json;
        console.warn(`[fetch_overpass] cell ${cellId} got 0 elements from ${mirror}, retrying to confirm...`);
        await sleep(1500 * (attempt + 1));
        continue;
      }

      await writeFile(cacheFile, JSON.stringify(json));
      return json.elements;
    } catch (err) {
      lastErr = err;
      console.warn(`[fetch_overpass] cell ${cellId} attempt ${attempt + 1} failed: ${err.message}`);
      await sleep(1500 * (attempt + 1));
    }
  }
  if (tentativeEmpty) {
    await writeFile(cacheFile, JSON.stringify(tentativeEmpty));
    return tentativeEmpty.elements;
  }
  throw lastErr;
}

function gridCells(bbox, cellSizeDeg) {
  const cells = [];
  for (let lat = bbox.minLat; lat < bbox.maxLat; lat += cellSizeDeg.lat) {
    for (let lon = bbox.minLon; lon < bbox.maxLon; lon += cellSizeDeg.lon) {
      cells.push({
        minLat: lat,
        maxLat: Math.min(lat + cellSizeDeg.lat, bbox.maxLat),
        minLon: lon,
        maxLon: Math.min(lon + cellSizeDeg.lon, bbox.maxLon),
      });
    }
  }
  return cells;
}

function coreCells() {
  // ~1.2km half-extent around Lund Cathedral -> ~2.4km box.
  const halfLat = 1200 / METERS_PER_DEG_LAT;
  const halfLon = 1200 / metersPerDegLon(SPAWN_LATLON.lat);
  return [
    {
      minLat: SPAWN_LATLON.lat - halfLat,
      maxLat: SPAWN_LATLON.lat + halfLat,
      minLon: SPAWN_LATLON.lon - halfLon,
      maxLon: SPAWN_LATLON.lon + halfLon,
    },
  ];
}

function allCells() {
  const cellSizeDeg = {
    lat: 2000 / METERS_PER_DEG_LAT,
    lon: 2000 / metersPerDegLon(ORIGIN.lat),
  };
  return gridCells(LUND_BBOX, cellSizeDeg);
}

async function main() {
  const mode = process.argv.includes('--all') ? 'all' : 'core';
  const cells = mode === 'core' ? coreCells() : allCells();

  console.log(`[fetch_overpass] mode=${mode} cells=${cells.length}`);

  const elementsById = new Map();
  for (let i = 0; i < cells.length; i++) {
    const cellId = `${mode}_${i}`;
    process.stdout.write(`[fetch_overpass] cell ${i + 1}/${cells.length}... `);
    const elements = await fetchCell(cells[i], cellId);
    for (const el of elements) {
      elementsById.set(`${el.type}/${el.id}`, el);
    }
    console.log(`ok (+${elements.length}, ${elementsById.size} unique total)`);
    if (i < cells.length - 1) await sleep(1000); // politeness delay between cells
  }

  console.log(`[fetch_overpass] total unique elements: ${elementsById.size}`);

  const features = convertToFeatures([...elementsById.values()], {
    project: projection.project,
    levelHeightM: LEVEL_HEIGHT_M,
    typeHeights: BUILDING_TYPE_HEIGHTS_M,
  });
  console.log(
    `[fetch_overpass] features: buildings=${features.buildings.length} roads=${features.roads.length} ` +
      `water=${features.water.length} landuse=${features.landuse.length} rail=${features.rail.length}`
  );

  const tilesMap = tileFeatures(features, TILE_SIZE_M);
  console.log(`[fetch_overpass] non-empty tiles: ${tilesMap.size}`);

  await mkdir(TILES_OUT_DIR, { recursive: true });
  for (const [key, tile] of tilesMap) {
    await writeFile(path.join(TILES_OUT_DIR, `${key}.json`), JSON.stringify(tile));
  }
  const manifest = buildManifest(tilesMap, { origin: ORIGIN, tileSizeM: TILE_SIZE_M });
  await writeFile(path.join(TILES_OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`[fetch_overpass] wrote ${tilesMap.size} tile files + manifest.json to ${TILES_OUT_DIR}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error('[fetch_overpass] FAILED:', err);
    process.exit(1);
  });
}
