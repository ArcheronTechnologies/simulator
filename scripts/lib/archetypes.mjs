// Citizen archetypes: the demographic buckets that drive both offline
// assignment (who works where, how many live in a home) and the runtime
// schedule (when they're out). Pure data + small pure helpers.

// Archetype enum. The index is what gets stored (uint8) in the shard's `arch`
// column, so the ORDER here is a stable on-disk contract — append only.
export const ARCHETYPES = [
  'worker', // 9-17 office/retail/industrial job
  'uniStudent', // university, irregular daytime
  'schoolChild', // school 8-15
  'retiree', // mostly home, midday errands
  'shift', // early/late/night rotation
  'home', // unemployed / works-from-home / very young
];

export const ARCHETYPE_INDEX = Object.fromEntries(ARCHETYPES.map((a, i) => [a, i]));

// Approximate share of the population in each archetype. Loosely modelled on a
// Swedish university town (Lund is ~1/5 students). Must sum to 1.
export const ARCHETYPE_MIX = {
  worker: 0.42,
  uniStudent: 0.18,
  schoolChild: 0.14,
  retiree: 0.14,
  shift: 0.07,
  home: 0.05,
};

// Which workplace subtypes (see classify_buildings.mjs) each archetype is
// eligible to be assigned to. Empty array => stays home / no fixed workplace.
export const WORKPLACE_ELIGIBILITY = {
  worker: ['office', 'retail', 'commercial', 'industrial', 'civic', 'health'],
  uniStudent: ['university'],
  schoolChild: ['school'],
  retiree: [],
  shift: ['retail', 'industrial', 'health', 'commercial'],
  home: [],
};

/**
 * Pick an archetype for a citizen deterministically from a unit-interval roll
 * in [0,1). Uses ARCHETYPE_MIX as a cumulative distribution.
 */
export function archetypeForRoll(roll) {
  let acc = 0;
  for (const arch of ARCHETYPES) {
    acc += ARCHETYPE_MIX[arch];
    if (roll < acc) return arch;
  }
  return ARCHETYPES[ARCHETYPES.length - 1];
}

/**
 * Estimated resident capacity of a home building from its footprint area (m^2)
 * and height (m). Detached houses hold a household (~3); apartment blocks scale
 * with floor area × floors. Always at least 1.
 */
export function homeCapacity(areaM2, heightM, subtype) {
  if (subtype === 'house') return 3;
  const floors = Math.max(1, Math.round(heightM / 3));
  // ~60 m^2 per dwelling, ~2.1 people per dwelling, only count plausible
  // residential floor area (cap floors so a data-error skyscraper can't spawn
  // thousands).
  const dwellings = Math.max(1, Math.round((areaM2 * Math.min(floors, 12)) / 60));
  return Math.max(1, Math.round(dwellings * 2.1));
}

/**
 * Estimated job capacity of a workplace building from footprint area (m^2) and
 * height (m). Schools/universities hold more per m^2 than offices. Always >= 1.
 */
export function jobCapacity(areaM2, heightM, subtype) {
  const floors = Math.max(1, Math.round(heightM / 3));
  const floorArea = areaM2 * Math.min(floors, 20);
  const perJob = subtype === 'school' || subtype === 'university' ? 12 : subtype === 'industrial' ? 60 : 25;
  return Math.max(1, Math.round(floorArea / perJob));
}
