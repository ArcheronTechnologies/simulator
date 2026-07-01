import { makeProjection } from './core/geo.js';

// Lunds kommun administrative boundary (via Nominatim), the whole-municipality
// extent for the data pipeline.
export const LUND_BBOX = {
  minLat: 55.5250,
  maxLat: 55.7940,
  minLon: 13.1113,
  maxLon: 13.6175,
};

// Local coordinate origin — the bbox midpoint, so the whole municipality
// stays within a float32-safe ±16km of (0,0).
export const ORIGIN = {
  lat: (LUND_BBOX.minLat + LUND_BBOX.maxLat) / 2,
  lon: (LUND_BBOX.minLon + LUND_BBOX.maxLon) / 2,
};

export const projection = makeProjection(ORIGIN.lat, ORIGIN.lon);

// Player spawns on a real path just outside Lund Cathedral (not the rural
// bbox midpoint, and verified clear of the Cathedral's own building
// footprint -- the original estimate landed ~19m away, inside a wall).
export const SPAWN_LATLON = { lat: 55.70481380770836, lon: 13.190765739866245 };

// --- Tile streaming ---
export const TILE_SIZE_M = 500;
export const LOAD_RADIUS = 2; // tiles, Chebyshev — 5x5 active grid (~2.5km view)
export const DISPOSE_RADIUS = 3; // hysteresis band to prevent load/dispose thrash

// --- Rendering ---
export const FOG_COLOR = 0xbfd9ff;
export const FOG_NEAR = (LOAD_RADIUS - 1) * TILE_SIZE_M;
export const FOG_FAR = LOAD_RADIUS * TILE_SIZE_M - 100; // tiles pop in inside the fog

// --- Building height heuristics (meters) ---
// Measured from a live OSM sample of central Lund: ~79% of buildings have
// neither `height` nor `building:levels` tagged, so type-based fallback
// matters more than it would in a more thoroughly-tagged city.
export const LEVEL_HEIGHT_M = 3.0;
export const BUILDING_TYPE_HEIGHTS_M = {
  house: 4,
  detached: 4,
  garage: 4,
  garages: 4,
  shed: 3,
  apartments: 12,
  residential: 10,
  terrace: 10,
  commercial: 8,
  retail: 8,
  industrial: 8,
  office: 10,
  university: 12,
  church: 20,
  cathedral: 24,
  default: 6,
};
