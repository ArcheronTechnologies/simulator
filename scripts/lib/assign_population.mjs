// Deterministic population assignment. Given classified homes and workplaces
// (already carrying positions + capacities), fills every home to its capacity
// with citizens, and gives each a globally-stable id, an archetype, a
// workplace (matched by archetype, distance-biased), and a leisure spot. Pure
// and seeded: same input + seed => byte-identical output, which is what makes
// the committed core shards reproducible and lets ids stay stable between the
// core and full datasets.
import { unitHash } from './hash.mjs';
import { archetypeForRoll, ARCHETYPE_INDEX, WORKPLACE_ELIGIBILITY, ARCHETYPES } from './archetypes.mjs';

const DEFAULT_TILE_SIZE_M = 500;
const CANDIDATE_SAMPLES = 8; // K-candidate nearest: cheap, deterministic, distance-biased

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function tileKeyFor(x, z, tileSizeM) {
  return `${Math.floor(x / tileSizeM)}_${Math.floor(z / tileSizeM)}`;
}

// Stable ordering so ids don't shift between runs: by tile, then position.
function sortByPlace(a, b) {
  return a.x - b.x || a.z - b.z;
}

/**
 * Pick a distance-biased element of `pool` for a citizen: sample K entries
 * deterministically from the citizen's id and keep the nearest. Returns null
 * for an empty pool.
 */
function pickNearest(pool, x, z, id, salt) {
  if (pool.length === 0) return null;
  let best = null;
  let bestD = Infinity;
  // Sample with replacement: K draws regardless of pool size, so the
  // distance bias is consistent whether there are 2 eligible jobs or 2000.
  for (let i = 0; i < CANDIDATE_SAMPLES; i++) {
    const idx = Math.floor(unitHash(id, `${salt}${i}`) * pool.length) % pool.length;
    const cand = pool[idx];
    const d = dist2(cand.x, cand.z, x, z);
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  return best;
}

/**
 * @param {object} input
 * @param {Array<{x,z,capacity,subtype}>} input.homes
 * @param {Array<{x,z,subtype}>} input.workplaces
 * @param {Array<{x,z}>} input.leisureSpots
 * @param {number} [input.tileSizeM]
 * @param {number} [input.populationScale] multiply home capacities (default 1 = 1:1)
 * @returns {{citizens: Array, stats: object}}
 */
export function assignPopulation({ homes, workplaces, leisureSpots = [], tileSizeM = DEFAULT_TILE_SIZE_M, populationScale = 1 }) {
  const sortedHomes = [...homes].sort(sortByPlace);

  // Bucket workplaces by subtype so an archetype's eligible pool is a cheap concat.
  const workBySubtype = new Map();
  for (const w of workplaces) {
    if (!workBySubtype.has(w.subtype)) workBySubtype.set(w.subtype, []);
    workBySubtype.get(w.subtype).push(w);
  }
  const eligiblePools = {};
  for (const arch of ARCHETYPES) {
    const pool = [];
    for (const sub of WORKPLACE_ELIGIBILITY[arch]) {
      const bucket = workBySubtype.get(sub);
      if (bucket) pool.push(...bucket);
    }
    eligiblePools[arch] = pool;
  }

  const citizens = [];
  const stats = { total: 0, byArchetype: Object.fromEntries(ARCHETYPES.map((a) => [a, 0])), withWork: 0 };
  let id = 0;

  for (const home of sortedHomes) {
    const count = Math.max(1, Math.round(home.capacity * populationScale));
    for (let n = 0; n < count; n++) {
      let arch = archetypeForRoll(unitHash(id, 'arch'));

      // Match a workplace; if the archetype needs one but none exist in the
      // dataset, they effectively stay home.
      let workXZ;
      let workTile;
      const pool = eligiblePools[arch];
      const work = pool && pool.length > 0 ? pickNearest(pool, home.x, home.z, id, 'work') : null;
      if (work) {
        workXZ = [work.x, work.z];
        workTile = tileKeyFor(work.x, work.z, tileSizeM);
        stats.withWork++;
      } else {
        if (WORKPLACE_ELIGIBILITY[arch].length > 0) arch = 'home'; // wanted work, found none
        workXZ = [home.x, home.z];
        workTile = tileKeyFor(home.x, home.z, tileSizeM);
      }

      const leisure = pickNearest(leisureSpots, home.x, home.z, id, 'leisure');
      const leisureXZ = leisure ? [leisure.x, leisure.z] : [home.x, home.z];

      citizens.push({
        id,
        arch: ARCHETYPE_INDEX[arch],
        homeXZ: [home.x, home.z],
        homeTile: tileKeyFor(home.x, home.z, tileSizeM),
        workXZ,
        workTile,
        leisureXZ,
      });
      stats.byArchetype[arch]++;
      stats.total++;
      id++;
    }
  }

  return { citizens, stats };
}
