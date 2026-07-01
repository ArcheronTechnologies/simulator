import { nearestPointOnPolylines } from '../../scripts/lib/spatial.mjs';

// Greedy road-following for citizen commuters: snap to the nearest street, then
// advance along it in whichever direction points toward the destination. Over
// the few hundred meters a citizen is visible this is indistinguishable from
// true pathfinding, and because the body is always re-snapped to a real road it
// can never walk through buildings or water. Pure (given road polylines) so the
// stepping math is unit-testable without THREE.

/**
 * Advance a walker one step of `distance` meters from (x,z) toward
 * (destX,destZ), constrained to the road network. `roads` is a list of road
 * entries ({p:[x,z,...]} or flat arrays). Returns { x, z, yaw, onRoad }.
 * yaw uses the app convention (facing -Z at 0): yaw = atan2(-dirX, -dirZ).
 */
export function stepAlongRoads(x, z, roads, destX, destZ, distance) {
  const snap = roads && roads.length ? nearestPointOnPolylines(roads, x, z) : null;

  if (!snap) {
    // No road nearby — head straight for the destination (rare fallback).
    const dx = destX - x;
    const dz = destZ - z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    return { x: x + ux * distance, z: z + uz * distance, yaw: Math.atan2(-ux, -uz), onRoad: false };
  }

  const line = roads[snap.line].p ?? roads[snap.line];
  const i = snap.seg * 2;
  let tx = line[i + 2] - line[i];
  let tz = line[i + 3] - line[i + 1];
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;

  // Walk along the segment in the direction that reduces distance to dest.
  const toDestX = destX - snap.x;
  const toDestZ = destZ - snap.z;
  if (tx * toDestX + tz * toDestZ < 0) {
    tx = -tx;
    tz = -tz;
  }

  return {
    x: snap.x + tx * distance,
    z: snap.z + tz * distance,
    yaw: Math.atan2(-tx, -tz),
    onRoad: true,
  };
}
