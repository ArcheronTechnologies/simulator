import { CitizenBody } from './CitizenBody.js';

// Fixed-capacity pool of reusable CitizenBody instances. All bodies are created
// once up front (SkeletonUtils clones are expensive) and recycled as citizens
// enter/leave the render radius — the per-frame path never allocates. This is
// the hard cap that keeps the visible crowd within the GPU skinned-mesh budget.
export class CitizenBodyPool {
  /**
   * @param {THREE.Scene} scene
   * @param {number} capacity
   */
  constructor(scene, capacity) {
    this.scene = scene;
    this.capacity = capacity;
    this.free = [];
    this.active = new Map(); // citizenId -> CitizenBody

    for (let i = 0; i < capacity; i++) {
      const body = new CitizenBody();
      scene.add(body.object);
      this.free.push(body);
    }
  }

  get activeCount() {
    return this.active.size;
  }

  get hasFree() {
    return this.free.length > 0;
  }

  isActive(citizenId) {
    return this.active.has(citizenId);
  }

  /** Acquire a body for a citizen, or null if the pool is exhausted. */
  acquire(citizenId) {
    if (this.active.has(citizenId)) return this.active.get(citizenId);
    const body = this.free.pop();
    if (!body) return null;
    body.assign(citizenId);
    this.active.set(citizenId, body);
    return body;
  }

  /** Release a citizen's body back to the pool. */
  release(citizenId) {
    const body = this.active.get(citizenId);
    if (!body) return;
    body.release();
    this.active.delete(citizenId);
    this.free.push(body);
  }

  /** Advance the mixers of only the active bodies. */
  update(delta) {
    for (const body of this.active.values()) body.update(delta);
  }

  /** Release every active body (e.g. on a big teleport). */
  releaseAll() {
    for (const id of [...this.active.keys()]) this.release(id);
  }
}
