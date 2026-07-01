// Serialize/deserialize a per-tile population shard in a compact columnar
// form. Columnar (parallel arrays) rather than array-of-objects keeps the JSON
// ~40% smaller and lets the runtime read straight into typed arrays. Shared by
// the offline generator (write) and the runtime PopulationStore (read).

// Meter precision: a citizen's anchor is "at this building", so sub-meter
// precision is wasted bytes. Integer coords roughly halve the shard size.
function roundCoord(n) {
  return Math.round(n);
}

/**
 * Serialize an array of citizen records (as produced by assignPopulation) into
 * the columnar shard object. All citizens passed should share a home tile.
 * `workTile` is intentionally NOT stored — it's derivable from workXZ at load
 * time (floor(x/tileSize)), so persisting it would just be redundant bytes.
 */
export function serializeShard(citizens) {
  const shard = {
    count: citizens.length,
    id: [],
    arch: [],
    homeXZ: [],
    workXZ: [],
    leisureXZ: [],
  };
  for (const c of citizens) {
    shard.id.push(c.id);
    shard.arch.push(c.arch);
    shard.homeXZ.push(roundCoord(c.homeXZ[0]), roundCoord(c.homeXZ[1]));
    shard.workXZ.push(roundCoord(c.workXZ[0]), roundCoord(c.workXZ[1]));
    shard.leisureXZ.push(roundCoord(c.leisureXZ[0]), roundCoord(c.leisureXZ[1]));
  }
  return shard;
}

/**
 * Deserialize a columnar shard back into an array of citizen records. Inverse
 * of serializeShard (coordinates are quantized to meters). `workTile` is not
 * included — the runtime derives it from workXZ.
 */
export function deserializeShard(shard) {
  const out = new Array(shard.count);
  for (let i = 0; i < shard.count; i++) {
    out[i] = {
      id: shard.id[i],
      arch: shard.arch[i],
      homeXZ: [shard.homeXZ[i * 2], shard.homeXZ[i * 2 + 1]],
      workXZ: [shard.workXZ[i * 2], shard.workXZ[i * 2 + 1]],
      leisureXZ: [shard.leisureXZ[i * 2], shard.leisureXZ[i * 2 + 1]],
    };
  }
  return out;
}

/**
 * Compact "work index" entry: the minimal data needed to render a commuter
 * ARRIVING at a workplace tile whose home is elsewhere (id + appearance +
 * both anchors). Written to population/work/{tile}.json.
 */
export function serializeWorkIndex(citizens) {
  const idx = { count: citizens.length, id: [], arch: [], homeXZ: [], workXZ: [] };
  for (const c of citizens) {
    idx.id.push(c.id);
    idx.arch.push(c.arch);
    idx.homeXZ.push(roundCoord(c.homeXZ[0]), roundCoord(c.homeXZ[1]));
    idx.workXZ.push(roundCoord(c.workXZ[0]), roundCoord(c.workXZ[1]));
  }
  return idx;
}

export function deserializeWorkIndex(idx) {
  const out = new Array(idx.count);
  for (let i = 0; i < idx.count; i++) {
    out[i] = {
      id: idx.id[i],
      arch: idx.arch[i],
      homeXZ: [idx.homeXZ[i * 2], idx.homeXZ[i * 2 + 1]],
      workXZ: [idx.workXZ[i * 2], idx.workXZ[i * 2 + 1]],
    };
  }
  return out;
}
