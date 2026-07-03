// Deterministic, seedable hashing + PRNG. Pure and dependency-free so it can
// run identically offline (population assignment) and at runtime (per-citizen
// schedule jitter, appearance). Same input -> same output, always: this is
// what makes citizens stable across sessions and the generator reproducible.

/**
 * xmur3 string-hash: mixes a string into a well-distributed 32-bit seed.
 * (Public-domain construction popularised by bryc's PRNG notes.)
 */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/**
 * mulberry32: fast 32-bit PRNG. Given a seed, returns a function producing a
 * deterministic stream of floats in [0, 1).
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit unsigned hash of `id` combined with a domain `salt`. */
export function hash32(id, salt = '') {
  return xmur3(`${salt}:${id}`)();
}

/**
 * Deterministic float in [0, 1) for `(id, salt)`. Different salts give
 * statistically independent values for the same id, so one citizen can have
 * an independent "wake jitter", "leave jitter", "colour", etc.
 */
export function unitHash(id, salt = '') {
  return hash32(id, salt) / 4294967296;
}

/**
 * Deterministic value in [min, max) for `(id, salt)`. Convenience over
 * unitHash for the common "pick a jittered time/offset" case.
 */
export function rangeHash(id, salt, min, max) {
  return min + unitHash(id, salt) * (max - min);
}
