#!/usr/bin/env node
// Generates the citizens of Lund from the cached OSM data: classifies every
// building into homes/workplaces, fills homes to capacity, assigns each citizen
// a workplace + leisure spot + archetype, and writes compact per-tile
// population shards under public/population/. Reads the SAME raw Overpass cache
// the tile pipeline uses (no re-fetch) — the full building tag set survives
// there even though the tiles themselves discard it.
//
// Usage: node scripts/generate_population.mjs --core   (ship-with-repo subset)
//        node scripts/generate_population.mjs --all    (whole municipality)
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMultipolygons } from './lib/rings.mjs';
import { centroidOfRing, ringArea } from './lib/spatial.mjs';
import { classifyBuilding } from './lib/classify_buildings.mjs';
import { homeCapacity, jobCapacity, ARCHETYPES } from './lib/archetypes.mjs';
import { assignPopulation } from './lib/assign_population.mjs';
import { serializeShard } from './lib/population_shard.mjs';
import { projection, ORIGIN, TILE_SIZE_M, LEVEL_HEIGHT_M, BUILDING_TYPE_HEIGHTS_M } from '../src/config.js';
import { tileKey, tileKeyForPosition } from '../src/core/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'cache', 'overpass');
const OUT_DIR = path.join(ROOT, 'public', 'population');
const WORLD_TILES_MANIFEST = path.join(ROOT, 'public', 'tiles', 'manifest.json');

// Target roughly the real population of Lund municipality (~125k). Per-home
// capacities are heuristics, so we scale them so the total lands near reality
// rather than trusting the raw sum. Deterministic given the cache.
const TARGET_POPULATION = 120000;

const RESIDENTIAL_LANDUSE = 5; // enum from osm_to_tiles.mjs
const WORKPLACE_LANDUSE = 6;
const PARK_LANDUSE_NAMES = new Set(['park', 'garden', 'nature_reserve', 'playground']);

function heightOf(tags) {
  if (tags.height) {
    const h = parseFloat(tags.height);
    if (!Number.isNaN(h)) return h;
  }
  if (tags['building:levels']) {
    const lv = parseFloat(tags['building:levels']);
    if (!Number.isNaN(lv)) return lv * LEVEL_HEIGHT_M;
  }
  return BUILDING_TYPE_HEIGHTS_M[tags.building] ?? BUILDING_TYPE_HEIGHTS_M.default;
}

function projectRing(latlon) {
  return latlon.map(({ lat, lon }) => {
    const { x, z } = projection.project(lat, lon);
    return [x, z];
  });
}

/** Outer ring(s) in world meters for a building/area element, or []. */
function outerRingsOf(el) {
  if (el.type === 'way' && el.geometry?.length >= 4) {
    return [projectRing(el.geometry)];
  }
  if (el.type === 'relation' && el.tags?.type === 'multipolygon' && el.members) {
    const members = el.members
      .filter((m) => m.type === 'way' && m.geometry)
      .map((m) => ({ role: m.role, geometry: m.geometry.map((p) => [p.lat, p.lon]) }));
    return buildMultipolygons(members).map((poly) =>
      poly.outer.map(([lat, lon]) => {
        const { x, z } = projection.project(lat, lon);
        return [x, z];
      })
    );
  }
  return [];
}

async function readAllCache() {
  if (!existsSync(CACHE_DIR)) {
    throw new Error(`No Overpass cache at ${CACHE_DIR}. Run "npm run data:all" first.`);
  }
  const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
  const byId = new Map();
  for (const f of files) {
    const data = JSON.parse(await readFile(path.join(CACHE_DIR, f), 'utf8'));
    for (const el of data.elements || []) byId.set(`${el.type}/${el.id}`, el);
  }
  return [...byId.values()];
}

/** Build a tile-bucketed index of landuse polygons for fast containment. */
function buildLanduseIndex(landusePolys) {
  const grid = new Map();
  for (const poly of landusePolys) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of poly.rings[0]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const minTx = Math.floor(minX / TILE_SIZE_M), maxTx = Math.floor(maxX / TILE_SIZE_M);
    const minTz = Math.floor(minZ / TILE_SIZE_M), maxTz = Math.floor(maxZ / TILE_SIZE_M);
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let tz = minTz; tz <= maxTz; tz++) {
        const key = tileKey(tx, tz);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(poly);
      }
    }
  }
  return grid;
}

function classifyAll(elements) {
  // First pass: collect landuse polygons (residential/workplace) + leisure spots.
  const landusePolys = [];
  const leisureSpots = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const luType = tags.landuse ? { residential: RESIDENTIAL_LANDUSE, commercial: WORKPLACE_LANDUSE, retail: WORKPLACE_LANDUSE, industrial: WORKPLACE_LANDUSE }[tags.landuse] : undefined;
    if (luType === RESIDENTIAL_LANDUSE || luType === WORKPLACE_LANDUSE) {
      const kind = luType === RESIDENTIAL_LANDUSE ? 'residential' : 'workplace';
      for (const outer of outerRingsOf(el)) landusePolys.push({ kind, rings: [outer] });
    }
    // Parks/gardens (leisure or landuse) -> leisure destinations.
    const isPark = (tags.leisure && PARK_LANDUSE_NAMES.has(tags.leisure)) || tags.landuse === 'recreation_ground';
    if (isPark) {
      for (const outer of outerRingsOf(el)) leisureSpots.push({ x: centroidOfRing(outer)[0], z: centroidOfRing(outer)[1] });
    }
  }
  const landuseIndex = buildLanduseIndex(landusePolys);

  // Second pass: classify buildings.
  const homes = [];
  const workplaces = [];
  const counts = { home: 0, work: 0, skip: 0 };
  for (const el of elements) {
    const tags = el.tags || {};
    if (!tags.building) continue;
    for (const outer of outerRingsOf(el)) {
      if (outer.length < 3) continue;
      const centroid = centroidOfRing(outer);
      const nearby = landuseIndex.get(tileKeyForPosition(centroid[0], centroid[1], TILE_SIZE_M)) || [];
      const cls = classifyBuilding(tags, centroid, nearby);
      if (cls.kind === 'skip') { counts.skip++; continue; }
      const area = ringArea(outer);
      const height = heightOf(tags);
      if (cls.kind === 'home') {
        homes.push({ x: centroid[0], z: centroid[1], subtype: cls.subtype, capacity: homeCapacity(area, height, cls.subtype) });
        counts.home++;
      } else {
        const wp = { x: centroid[0], z: centroid[1], subtype: cls.subtype, capacity: jobCapacity(area, height, cls.subtype) };
        workplaces.push(wp);
        counts.work++;
        if (cls.subtype === 'retail' || cls.subtype === 'civic') leisureSpots.push({ x: wp.x, z: wp.z });
      }
    }
  }
  return { homes, workplaces, leisureSpots, landusePolys, counts };
}

// "Core" means "actually in the committed world-geometry tileset" -- read
// the real manifest rather than re-deriving an approximate distance-from-
// spawn test. fetch_overpass.mjs's core fetch box is a lat/lon rectangle
// (converted from CORE_HALF_EXTENT_M via degree-per-meter math), while a
// geometric reconstruction here would use projected meters directly; the two
// methods don't produce identical tile sets even at the same nominal extent
// (confirmed: several real committed tiles' centers land 1200-1300m out,
// just past a naive 1200m-in-meters cutoff). Checking real membership can't
// drift from whatever fetch_overpass.mjs actually produced.
//
// That guarantee only holds when the manifest itself IS the core fetch,
// though: if `npm run data:all` ran more recently than `npm run data:core`,
// public/tiles/manifest.json lists the whole municipality, and every home
// tile would silently read back as "core" -- ballooning a `--core` population
// run to thousands of shards instead of the intended ~58. Refuse rather than
// silently do that; a manifest with no generatedMode at all is a legacy/
// pre-existing --core manifest (the field didn't always exist) and is fine.
async function loadCoreTileKeys(mode) {
  const manifest = JSON.parse(await readFile(WORLD_TILES_MANIFEST, 'utf8'));
  if (mode === 'core' && manifest.generatedMode === 'all') {
    throw new Error(
      'public/tiles/manifest.json was generated with --all, so tile membership no longer ' +
      'identifies the core subset. Run "npm run data:core" to regenerate it before ' +
      '"npm run data:population" (--core), or use "node scripts/generate_population.mjs --all" ' +
      'if you want population for the whole currently-loaded dataset.'
    );
  }
  return new Set(Object.keys(manifest.tiles));
}

async function main() {
  const mode = process.argv.includes('--all') ? 'all' : 'core';
  console.log(`[generate_population] mode=${mode}, reading cache...`);
  const elements = await readAllCache();
  console.log(`[generate_population] ${elements.length} unique OSM elements`);

  const { homes, workplaces, leisureSpots, counts } = classifyAll(elements);
  console.log(`[generate_population] classified: ${counts.home} homes, ${counts.work} workplaces, ${counts.skip} skipped; ${leisureSpots.length} leisure spots`);

  // Scale raw capacity heuristics so the total lands near Lund's real
  // population. Deterministic (depends only on the cache).
  const rawCapacity = homes.reduce((a, h) => a + h.capacity, 0);
  const populationScale = rawCapacity > 0 ? TARGET_POPULATION / rawCapacity : 1;
  console.log(`[generate_population] raw capacity ${rawCapacity} -> scale ${populationScale.toFixed(3)} for ~${TARGET_POPULATION} target`);

  const { citizens, stats } = assignPopulation({ homes, workplaces, leisureSpots, tileSizeM: TILE_SIZE_M, populationScale });
  console.log(`[generate_population] assigned ${stats.total} citizens (${stats.withWork} with a workplace)`);
  console.log('[generate_population] archetype mix:', stats.byArchetype);

  // Shard citizens by home tile. (v1 renders residents + departing commuters,
  // so a home-tile bucket is all the runtime needs; arriving-from-afar
  // commuters via a separate work index are a documented future add-on.)
  const byHomeTile = new Map();
  for (const c of citizens) {
    if (!byHomeTile.has(c.homeTile)) byHomeTile.set(c.homeTile, []);
    byHomeTile.get(c.homeTile).push(c);
  }

  // Fresh output dir (keep it deterministic — no stale shards from a prior run).
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const coreTileKeys = await loadCoreTileKeys(mode);
  const manifestTiles = {};
  let written = 0;
  for (const [tile, list] of byHomeTile) {
    const core = coreTileKeys.has(tile);
    if (mode === 'core' && !core) continue;
    await writeFile(path.join(OUT_DIR, `${tile}.json`), JSON.stringify(serializeShard(list)));
    manifestTiles[tile] = { n: list.length, core };
    written++;
  }

  const manifest = {
    origin: ORIGIN,
    tileSize: TILE_SIZE_M,
    totalCitizens: mode === 'all' ? stats.total : Object.values(manifestTiles).reduce((a, t) => a + t.n, 0),
    generatedMode: mode,
    archetypes: ARCHETYPES,
    tiles: manifestTiles,
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));

  console.log(`[generate_population] wrote ${written} home shards + manifest to public/population (${mode})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[generate_population] FAILED:', err);
    process.exit(1);
  });
}
