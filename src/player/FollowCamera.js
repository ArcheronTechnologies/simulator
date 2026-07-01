import * as THREE from 'three';

const DESIRED_DISTANCE = 6; // m, behind the character
const MIN_DISTANCE = 1.2; // m, never let an obstruction pull the camera closer than this
const HEIGHT_OFFSET = 1.4; // m, orbit center height (roughly chest/head)
const SKIN = 0.15; // m, pull-in margin so the near plane doesn't clip the obstruction

const MOUSE_SENSITIVITY = 0.0025;
const PITCH_MIN = -1.2; // rad
const PITCH_MAX = 1.0; // rad

const EASE_IN_PER_S = 20; // pulling closer (obstruction appeared): snappy
const EASE_OUT_PER_S = 4; // easing back out (obstruction cleared): gentler, avoids a jarring pop

/**
 * Third-person orbit camera: mouse-look via Pointer Lock, with a raycast
 * pull-in against the same nearby collider meshes the character uses so
 * the camera never clips through a building wall.
 */
export class FollowCamera {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.yaw = 0;
    this.pitch = 0.25;
    this.distance = DESIRED_DISTANCE;

    this._raycaster = new THREE.Raycaster();
    this._orbitCenter = new THREE.Vector3();
    this._offsetDir = new THREE.Vector3();

    domElement.addEventListener('click', () => domElement.requestPointerLock());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== domElement) return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch -= e.movementY * MOUSE_SENSITIVITY;
      this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch));
    });
  }

  update(targetPosition, colliderMeshes, delta) {
    this._orbitCenter.set(targetPosition.x, targetPosition.y + HEIGHT_OFFSET, targetPosition.z);

    // Matches the app-wide yaw convention: forward = (-sin(yaw), 0, -cos(yaw)).
    // The camera sits behind the character, i.e. along -forward.
    this._offsetDir.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    );

    let targetDistance = DESIRED_DISTANCE;
    if (colliderMeshes.length > 0) {
      this._raycaster.set(this._orbitCenter, this._offsetDir);
      this._raycaster.far = DESIRED_DISTANCE;
      const hits = this._raycaster.intersectObjects(colliderMeshes, false);
      if (hits.length > 0) {
        targetDistance = Math.max(MIN_DISTANCE, hits[0].distance - SKIN);
      }
    }

    const easeRate = targetDistance < this.distance ? EASE_IN_PER_S : EASE_OUT_PER_S;
    const t = Math.min(1, easeRate * delta);
    this.distance += (targetDistance - this.distance) * t;

    this.camera.position.copy(this._orbitCenter).addScaledVector(this._offsetDir, this.distance);
    this.camera.lookAt(this._orbitCenter);
  }
}
