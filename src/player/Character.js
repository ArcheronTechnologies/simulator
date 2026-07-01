import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_URL = './assets/AnimationLibrary_Godot_Standard.gltf';
const CROSSFADE_S = 0.25;

// Clip name -> movement state, from the Quaternius Universal Animation
// Library (see scripts/fetch_character.mjs).
const CLIP_NAMES = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
};

const FALLBACK_HEIGHT_M = 1.8;
const FALLBACK_RADIUS_M = 0.35;

/**
 * Loads the rigged character and drives an idle/walk/run animation state
 * machine. Falls back to a plain capsule with a simple procedural walk-bob
 * if the model can't be loaded, so the POC always has a controllable body.
 */
export class Character {
  constructor() {
    this.object = new THREE.Group();
    this.mixer = null;
    this.actions = {};
    this.state = 'idle';
    this._isFallback = false;
    this._bobPhase = 0;
  }

  async load() {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(MODEL_URL);
      this._buildFromGltf(gltf);
    } catch (err) {
      console.error('[Character] model load failed, using fallback capsule:', err);
      this._buildFallback();
    }
    return this;
  }

  _buildFromGltf(gltf) {
    const model = gltf.scene;
    this.object.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    for (const [state, clipName] of Object.entries(CLIP_NAMES)) {
      const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
      if (!clip) {
        console.warn(`[Character] animation clip "${clipName}" not found for state "${state}"`);
        continue;
      }
      const action = this.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(state === this.state ? 1 : 0);
      this.actions[state] = action;
    }
  }

  _buildFallback() {
    this._isFallback = true;
    const geometry = new THREE.CapsuleGeometry(FALLBACK_RADIUS_M, FALLBACK_HEIGHT_M - 2 * FALLBACK_RADIUS_M, 4, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.8 });
    this._fallbackMesh = new THREE.Mesh(geometry, material);
    this._fallbackMesh.position.y = FALLBACK_HEIGHT_M / 2;
    this.object.add(this._fallbackMesh);
  }

  /** @param {'idle'|'walk'|'run'} state */
  setState(state) {
    if (state === this.state) return;
    const next = this.actions[state];
    const prev = this.actions[this.state];
    if (next) {
      next.reset();
      // fadeIn() only schedules a ramp that multiplies the action's
      // existing base weight -- since inactive actions are constructed
      // with base weight 0 (below), the ramp would compute 0 * anything
      // and never actually reach 1 without this.
      next.setEffectiveWeight(1);
      next.fadeIn(CROSSFADE_S);
      next.play();
    }
    if (prev) prev.fadeOut(CROSSFADE_S);
    this.state = state;
  }

  update(delta) {
    if (this.mixer) {
      this.mixer.update(delta);
      return;
    }
    if (this._isFallback) {
      // Cheap procedural motion so a walking fallback capsule doesn't look
      // static: bob + tilt while moving, hold still while idle.
      const target = this.state === 'idle' ? 0 : this.state === 'run' ? 14 : 8;
      this._bobPhase += delta * target;
      const bob = this.state === 'idle' ? 0 : Math.sin(this._bobPhase) * 0.06;
      this._fallbackMesh.position.y = FALLBACK_HEIGHT_M / 2 + bob;
      this._fallbackMesh.rotation.z = this.state === 'idle' ? 0 : Math.sin(this._bobPhase) * 0.03;
    }
  }
}
