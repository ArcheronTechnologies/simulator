import * as THREE from 'three';

// three-mesh-bvh's Triangle.closestPointToSegment only checks the
// triangle's 3 edges against the segment and the segment's 2 endpoints
// against the triangle -- it never checks the case where the segment
// pierces straight through the triangle's *interior*. That's exactly the
// common case of a capsule standing on a large flat surface away from any
// triangle edge (verified empirically: a capsule resting on flat ground
// would report a bogus ~1m clearance and fall straight through). This
// wraps the library call with that missing case, using the triangle's own
// plane + standard barycentric containment (both winding-independent).
const _planeHit = new THREE.Vector3();
const _pushDir = new THREE.Vector3();

/**
 * @param {import('three-mesh-bvh').ExtendedTriangle} tri
 * @param {THREE.Line3} segment
 * @param {THREE.Vector3} triPointOut - closest point on the triangle (output)
 * @param {THREE.Vector3} capsulePointOut - closest point on the segment (output)
 * @returns {{distance: number, pierced: boolean}}
 */
export function closestSegmentTriangleDistance(tri, segment, triPointOut, capsulePointOut) {
  const distance = tri.closestPointToSegment(segment, triPointOut, capsulePointOut);

  // closestPointToSegment doesn't touch tri.plane, so it's only valid if
  // something else already forced an update on this (pooled, reused)
  // triangle instance this callback -- never assume, always ensure.
  if (tri.needsUpdate) tri.update();

  if (tri.plane.intersectLine(segment, _planeHit) && tri.containsPoint(_planeHit)) {
    if (0 < distance) {
      triPointOut.copy(_planeHit);
      capsulePointOut.copy(_planeHit);
      return { distance: 0, pierced: true };
    }
  }

  return { distance, pierced: false };
}

/**
 * Push direction for a pierced (interior-crossing) contact: along the
 * triangle's plane normal, oriented toward whichever side the segment's
 * start (by convention, the capsule's lower/feet end) already sits on --
 * robust regardless of the triangle's winding direction.
 */
export function piercedPushDirection(tri, segment, target) {
  const sign = Math.sign(tri.plane.distanceToPoint(segment.start)) || 1;
  return target.copy(tri.plane.normal).multiplyScalar(sign);
}
