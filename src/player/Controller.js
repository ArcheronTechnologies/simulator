import * as THREE from 'three';
import { isKeyDown } from '../core/Input.js';
import { closestSegmentTriangleDistance, piercedPushDirection } from './capsuleCollision.js';

const GRAVITY = -30; // m/s^2, a bit stronger than real-world for snappier game feel
const WALK_SPEED = 3.2; // m/s, real human walking pace
const RUN_SPEED = 6.5; // m/s, real human jogging pace
const JUMP_SPEED = 8;
const FACING_TURN_SPEED = 12; // rad/s, how fast the character visually turns to face movement

const CAPSULE_RADIUS = 0.35;
const CAPSULE_HEIGHT = 1.8; // matches the loaded character's real height

// The loaded character model faces -Z at rotation.y=0, matching the
// forward = (-sin(yaw), 0, -cos(yaw)) convention used throughout the app.
const MODEL_FORWARD_OFFSET = 0;

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Capsule-vs-BVH character controller: gravity, WASD movement relative to
 * the camera's yaw, and three-mesh-bvh shapecast depenetration against the
 * nearby streamed tile colliders (ground + buildings). Position is tracked
 * at the feet/ground-contact point, matching how Character's model is
 * authored. The character's visual facing eases toward its movement
 * direction rather than snapping to the camera yaw directly, so strafing
 * doesn't look like sliding.
 */
export class Controller {
  constructor(character, collider) {
    this.character = character;
    this.collider = collider;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.facingYaw = 0;
    this.isOnGround = false;

    this._moving = false;
    this._running = false;

    this._segment = new THREE.Line3();
    this._box = new THREE.Box3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._moveVec = new THREE.Vector3();
    this._triPoint = new THREE.Vector3();
    this._capsulePoint = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._newFeetPos = new THREE.Vector3();
    this._deltaVector = new THREE.Vector3();
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this._syncVisual();
  }

  /** @param {number} cameraYaw - movement directions (WASD) are relative to this */
  update(delta, cameraYaw) {
    this._applyInput(delta, cameraYaw);
    this._applyGravityAndIntegrate(delta);
    this._resolveCollisions(delta);
    this._updateFacing(delta);
    this._syncVisual();
    this._updateAnimationState();
    this.character.update(delta);
  }

  _applyInput(delta, cameraYaw) {
    this._running = isKeyDown('ShiftLeft') || isKeyDown('ShiftRight');
    const speed = this._running ? RUN_SPEED : WALK_SPEED;

    this._forward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    this._right.set(-Math.cos(cameraYaw), 0, Math.sin(cameraYaw));

    this._moveVec.set(0, 0, 0);
    if (isKeyDown('KeyW')) this._moveVec.add(this._forward);
    if (isKeyDown('KeyS')) this._moveVec.addScaledVector(this._forward, -1);
    if (isKeyDown('KeyD')) this._moveVec.add(this._right);
    if (isKeyDown('KeyA')) this._moveVec.addScaledVector(this._right, -1);

    this._moving = this._moveVec.lengthSq() > 0;
    if (this._moving) {
      this._moveVec.normalize();
      this.position.addScaledVector(this._moveVec, speed * delta);
    }

    if (isKeyDown('Space') && this.isOnGround) {
      this.velocity.y = JUMP_SPEED;
      this.isOnGround = false;
    }
  }

  _applyGravityAndIntegrate(delta) {
    if (this.isOnGround) {
      this.velocity.y = delta * GRAVITY;
    } else {
      this.velocity.y += delta * GRAVITY;
    }
    this.position.addScaledVector(this.velocity, delta);
  }

  _resolveCollisions(delta) {
    this._segment.start.set(this.position.x, this.position.y + CAPSULE_RADIUS, this.position.z);
    this._segment.end.set(this.position.x, this.position.y + CAPSULE_HEIGHT - CAPSULE_RADIUS, this.position.z);

    const colliders = this.collider.nearbyColliders(this.position.x, this.position.z);
    for (const mesh of colliders) {
      if (!mesh.geometry.boundsTree) continue;

      this._box.makeEmpty();
      this._box.expandByPoint(this._segment.start);
      this._box.expandByPoint(this._segment.end);
      this._box.min.addScalar(-CAPSULE_RADIUS);
      this._box.max.addScalar(CAPSULE_RADIUS);

      mesh.geometry.boundsTree.shapecast({
        intersectsBounds: (box) => box.intersectsBox(this._box),
        intersectsTriangle: (tri) => {
          const { distance, pierced } = closestSegmentTriangleDistance(
            tri,
            this._segment,
            this._triPoint,
            this._capsulePoint
          );
          if (distance < CAPSULE_RADIUS) {
            const depth = CAPSULE_RADIUS - distance;
            if (pierced) {
              piercedPushDirection(tri, this._segment, this._direction);
            } else {
              this._direction.subVectors(this._capsulePoint, this._triPoint).normalize();
            }
            this._segment.start.addScaledVector(this._direction, depth);
            this._segment.end.addScaledVector(this._direction, depth);
          }
        },
      });
    }

    this._newFeetPos.set(this._segment.start.x, this._segment.start.y - CAPSULE_RADIUS, this._segment.start.z);
    this._deltaVector.subVectors(this._newFeetPos, this.position);

    // Primarily-vertical correction means we landed on something -- treat it as ground.
    this.isOnGround = this._deltaVector.y > Math.abs(delta * this.velocity.y * 0.25);

    const offset = Math.max(0, this._deltaVector.length() - 1e-5);
    this._deltaVector.normalize().multiplyScalar(offset);
    this.position.add(this._deltaVector);

    if (!this.isOnGround && this._deltaVector.lengthSq() > 0) {
      this._deltaVector.normalize();
      this.velocity.addScaledVector(this._deltaVector, -this._deltaVector.dot(this.velocity));
    } else if (this.isOnGround) {
      this.velocity.y = 0;
    }
  }

  _updateFacing(delta) {
    if (!this._moving) return;
    const targetYaw = Math.atan2(-this._moveVec.x, -this._moveVec.z);
    const delta_ = shortestAngleDelta(this.facingYaw, targetYaw);
    const maxStep = FACING_TURN_SPEED * delta;
    this.facingYaw += Math.abs(delta_) <= maxStep ? delta_ : Math.sign(delta_) * maxStep;
  }

  _syncVisual() {
    this.character.object.position.copy(this.position);
    this.character.object.rotation.y = this.facingYaw + MODEL_FORWARD_OFFSET;
  }

  _updateAnimationState() {
    if (!this.isOnGround || !this._moving) {
      this.character.setState('idle');
    } else if (this._running) {
      this.character.setState('run');
    } else {
      this.character.setState('walk');
    }
  }
}
