// Pure day/night model: maps an hour-of-day to sun angle, light intensities,
// and sky/ground/sun colours. No THREE — just math and colour interpolation —
// so it's unit-testable and the SkyController stays a thin applicator.

// Colour keyframes through the day. Hours are ascending; the table wraps
// (24:00 == 00:00). Colours are packed 0xRRGGBB.
const KEYFRAMES = [
  { h: 0, sky: 0x0a1024, ground: 0x05070c, sun: 0x223355, sunI: 0.04, hemiI: 0.22 },
  { h: 5, sky: 0x243150, ground: 0x14161c, sun: 0x556699, sunI: 0.12, hemiI: 0.4 },
  { h: 7, sky: 0xe6a06a, ground: 0x3a3230, sun: 0xffb066, sunI: 1.0, hemiI: 0.7 },
  { h: 9, sky: 0xbcd6f5, ground: 0x2b2418, sun: 0xfff0d8, sunI: 1.5, hemiI: 1.0 },
  { h: 12, sky: 0xbfd9ff, ground: 0x2b2418, sun: 0xfff4e0, sunI: 1.7, hemiI: 1.1 },
  { h: 17, sky: 0xbccfee, ground: 0x2b2418, sun: 0xffe9c0, sunI: 1.4, hemiI: 1.0 },
  { h: 19, sky: 0xe08a5a, ground: 0x342420, sun: 0xff8a4d, sunI: 0.85, hemiI: 0.6 },
  { h: 21, sky: 0x3a3a58, ground: 0x14161c, sun: 0x445577, sunI: 0.2, hemiI: 0.4 },
  { h: 24, sky: 0x0a1024, ground: 0x05070c, sun: 0x223355, sunI: 0.04, hemiI: 0.22 },
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Linearly interpolate two packed 0xRRGGBB colours, returning a packed int. */
export function lerpColorHex(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

function surroundingFrames(hour) {
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (hour >= KEYFRAMES[i].h && hour <= KEYFRAMES[i + 1].h) {
      const t = (hour - KEYFRAMES[i].h) / (KEYFRAMES[i + 1].h - KEYFRAMES[i].h);
      return { a: KEYFRAMES[i], b: KEYFRAMES[i + 1], t };
    }
  }
  return { a: KEYFRAMES[0], b: KEYFRAMES[0], t: 0 };
}

/**
 * Full sky state for an hour in [0,24). Returns colours as packed ints,
 * intensities as floats, and the sun direction as azimuth/elevation:
 * elevation in [-1,1] (1 = zenith at noon, negative at night), azimuth sweeps
 * the sun east->west across the day.
 */
export function skyStateForHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  const { a, b, t } = surroundingFrames(h);

  // Sun rises ~06:00, peaks at noon, sets ~18:00; below the horizon at night.
  const sunElevation = Math.sin(((h - 6) / 12) * Math.PI);
  const sunAzimuth = (h / 24) * Math.PI * 2;

  return {
    sunElevation,
    sunAzimuth,
    sunIntensity: Math.max(0, lerp(a.sunI, b.sunI, t)),
    hemiIntensity: Math.max(0, lerp(a.hemiI, b.hemiI, t)),
    skyColor: lerpColorHex(a.sky, b.sky, t),
    groundColor: lerpColorHex(a.ground, b.ground, t),
    sunColor: lerpColorHex(a.sun, b.sun, t),
  };
}

/** True when the sun is below the horizon (used for e.g. street-light logic). */
export function isNight(hour) {
  return skyStateForHour(hour).sunElevation < 0;
}
