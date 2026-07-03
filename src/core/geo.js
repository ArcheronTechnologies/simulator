// Equirectangular projection into local ENU meters, centered on a given
// origin. Isotropic to within ~1m over Lund's ~30km span at this latitude —
// simpler than UTM and accurate enough for a walkable city.
const EARTH_RADIUS_M = 6378137; // WGS84 equatorial radius

export function makeProjection(originLat, originLon) {
  const latRad0 = (originLat * Math.PI) / 180;
  const cosLat0 = Math.cos(latRad0);

  function project(lat, lon) {
    const x = ((lon - originLon) * Math.PI) / 180 * EARTH_RADIUS_M * cosLat0;
    const z = -(((lat - originLat) * Math.PI) / 180) * EARTH_RADIUS_M;
    return { x, z };
  }

  function unproject(x, z) {
    const lon = originLon + (x / (EARTH_RADIUS_M * cosLat0)) * (180 / Math.PI);
    const lat = originLat - (z / EARTH_RADIUS_M) * (180 / Math.PI);
    return { lat, lon };
  }

  return { project, unproject };
}

export function tileIndex(x, z, tileSize) {
  return { tx: Math.floor(x / tileSize), tz: Math.floor(z / tileSize) };
}

export function tileKey(tx, tz) {
  return `${tx}_${tz}`;
}

export function tileKeyForPosition(x, z, tileSize) {
  const { tx, tz } = tileIndex(x, z, tileSize);
  return tileKey(tx, tz);
}

export function chebyshevDistance(tx1, tz1, tx2, tz2) {
  return Math.max(Math.abs(tx1 - tx2), Math.abs(tz1 - tz2));
}
