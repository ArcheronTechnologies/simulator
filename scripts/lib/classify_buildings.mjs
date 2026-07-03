// Classifies an OSM building as a home, a workplace (with a subtype), or
// something to skip (garages, churches, sheds...). Pure: the tag rules are
// unit-testable in isolation, and landuse containment is resolved through a
// caller-supplied point test so no spatial index leaks in here.
import { pointInRing } from './rings.mjs';

// building=* values that are never homes and never meaningful workplaces.
const SKIP_BUILDINGS = new Set([
  'garage', 'garages', 'carport', 'shed', 'roof', 'greenhouse', 'hut',
  'service', 'farm_auxiliary', 'barn', 'stable', 'sty', 'hangar', 'container',
  'bunker', 'ruins', 'construction', 'parking', 'transformer_tower',
  'water_tower', 'silo', 'storage_tank', 'kiosk', 'tent', 'cowshed',
]);

// Places of worship: big footprints but negligible resident/worker counts —
// exclude so we don't assign crowds to "work at the cathedral".
const WORSHIP_BUILDINGS = new Set(['church', 'cathedral', 'chapel', 'mosque', 'synagogue', 'temple', 'shrine']);

// building=* residential values -> home subtype.
const RESIDENTIAL_BUILDINGS = {
  house: 'house', detached: 'house', semidetached_house: 'house', semi_detached_house: 'house',
  bungalow: 'house', cabin: 'house', static_caravan: 'house',
  apartments: 'apartments', residential: 'apartments', terrace: 'apartments',
  dormitory: 'apartments', houseboat: 'apartments',
};

// building=* workplace values -> work subtype.
const WORKPLACE_BUILDINGS = {
  office: 'office',
  commercial: 'commercial', retail: 'retail', supermarket: 'retail', kiosk: 'retail',
  industrial: 'industrial', warehouse: 'industrial', manufacture: 'industrial',
  school: 'school', kindergarten: 'school', college: 'university', university: 'university',
  hospital: 'health',
  civic: 'civic', public: 'civic', government: 'civic', townhall: 'civic', hotel: 'commercial',
};

// amenity=* values that employ people -> work subtype. (Others — parking,
// bicycle_parking, shelter, recycling, fuel, bench — are ignored as workplaces.)
const WORK_AMENITIES = {
  school: 'school', kindergarten: 'school', college: 'university', university: 'university',
  hospital: 'health', clinic: 'health', doctors: 'health', dentist: 'health', pharmacy: 'health', veterinary: 'health',
  restaurant: 'retail', cafe: 'retail', fast_food: 'retail', bar: 'retail', pub: 'retail', food_court: 'retail',
  bank: 'commercial', post_office: 'commercial', library: 'civic', townhall: 'civic',
  community_centre: 'civic', theatre: 'civic', cinema: 'retail', arts_centre: 'civic',
  marketplace: 'retail', courthouse: 'civic', police: 'civic', fire_station: 'civic',
  nursing_home: 'health', social_facility: 'health', childcare: 'school',
};

/**
 * Classify from tags alone. Returns { kind, subtype, name } where kind is
 * 'home' | 'work' | 'skip' | 'unknown'. 'unknown' means "a plain building with
 * no functional tags" — the caller resolves those via landuse containment.
 */
export function classifyByTags(tags) {
  const b = tags.building;
  const name = tags.name || null;

  if (!b || b === 'no') return { kind: 'skip', subtype: null, name };
  if (SKIP_BUILDINGS.has(b) || WORSHIP_BUILDINGS.has(b)) {
    // A worship/garage building can still carry a real workplace amenity
    // (e.g. a community centre in a former chapel); honour explicit work tags.
    const w = workFromPoiTags(tags);
    return w ? { kind: 'work', subtype: w, name } : { kind: 'skip', subtype: null, name };
  }

  // Explicit POI tags win over the generic building type (a building=yes with
  // shop=convenience is a shop, not an unknown).
  const poi = workFromPoiTags(tags);
  if (poi) return { kind: 'work', subtype: poi, name };

  if (b in WORKPLACE_BUILDINGS) return { kind: 'work', subtype: WORKPLACE_BUILDINGS[b], name };
  if (b in RESIDENTIAL_BUILDINGS) return { kind: 'home', subtype: RESIDENTIAL_BUILDINGS[b], name };

  return { kind: 'unknown', subtype: null, name };
}

function workFromPoiTags(tags) {
  if (tags.shop) return 'retail';
  if (tags.office) return 'office';
  if (tags.amenity && tags.amenity in WORK_AMENITIES) return WORK_AMENITIES[tags.amenity];
  if (tags.healthcare) return 'health';
  if (tags.tourism === 'hotel' || tags.tourism === 'hostel') return 'commercial';
  return null;
}

/**
 * Landuse kind at a point, or null. `landusePolys` is an array of
 * { kind: 'residential'|'workplace', rings: [outer, ...holes] } where each ring
 * is an array of [x,z]. First outer-hit (not in a hole) wins.
 */
export function landuseKindAt(landusePolys, x, z) {
  for (const poly of landusePolys) {
    const [outer, ...holes] = poly.rings;
    if (!pointInRing([x, z], outer)) continue;
    if (holes.some((h) => pointInRing([x, z], h))) continue;
    return poly.kind;
  }
  return null;
}

/**
 * Full classification: tags first, then landuse containment for 'unknown'
 * buildings, then a residential default (Lund is overwhelmingly residential,
 * so an untagged building in no landuse zone is most likely a home).
 */
export function classifyBuilding(tags, centroid, landusePolys) {
  const byTags = classifyByTags(tags);
  if (byTags.kind !== 'unknown') return byTags;

  const [x, z] = centroid;
  const lu = landuseKindAt(landusePolys, x, z);
  if (lu === 'workplace') return { kind: 'work', subtype: 'commercial', name: byTags.name };
  // An untagged building is most often a single dwelling (Lund is dominated by
  // detached/terraced housing); treat it as a house rather than an apartment
  // block so per-building capacity doesn't balloon the population.
  return { kind: 'home', subtype: 'house', name: byTags.name };
}

/** Landuse `type` enum values (see osm_to_tiles.mjs) grouped for population. */
export const RESIDENTIAL_LANDUSE_TYPES = new Set([5]);
export const WORKPLACE_LANDUSE_TYPES = new Set([6]);
