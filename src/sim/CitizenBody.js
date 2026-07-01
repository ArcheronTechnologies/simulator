import * as THREE from 'three';
import { makeCitizenClone, CITIZEN_CLIPS } from './citizenModel.js';
import { unitHash } from '../../scripts/lib/hash.mjs';

const CROSSFADE_S = 0.2;

// A pooled, reusable animated citizen. Wraps one skeleton clone + its own
// AnimationMixer + per-body tinted material, with an idle/walk crossfade state
// machine (the same setEffectiveWeight-before-fadeIn fix the player uses, since
// inactive actions start at base weight 0). Bodies are created once and reused:
// `assign()` re-skins one for a new citizen without allocating.
export class CitizenBody {
  constructor() {
    const { root, materials, animations } = makeCitizenClone();
    this.object = root;
    this.object.visible = false;
    this._materials = materials;
    this._baseColors = materials.map((m) => m.color.clone());

    this.mixer = new THREE.AnimationMixer(this.object);
    this.actions = {};
    for (const [state, name] of Object.entries(CITIZEN_CLIPS)) {
      const clip = THREE.AnimationClip.findByName(animations, name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(state === 'idle' ? 1 : 0);
      this.actions[state] = action;
    }
    this.state = 'idle';

    this.citizenId = null;
    this.inUse = false;
    this._tmpColor = new THREE.Color();
  }

  /** Re-skin this body for a citizen: tint, height variation, reset pose. */
  assign(citizenId) {
    this.citizenId = citizenId;
    this.inUse = true;

    // Deterministic muted clothing tint + slight height variation per citizen.
    const hue = unitHash(citizenId, 'hue');
    const sat = 0.25 + unitHash(citizenId, 'sat') * 0.35;
    const light = 0.35 + unitHash(citizenId, 'light') * 0.35;
    this._tmpColor.setHSL(hue, sat, light);
    for (let i = 0; i < this._materials.length; i++) {
      this._materials[i].color.copy(this._baseColors[i]).multiply(this._tmpColor).addScalar(0.05);
    }
    const scale = 0.92 + unitHash(citizenId, 'scale') * 0.16; // ~1.7-2.0m tall
    this.object.scale.setScalar(scale);

    // Desync animation phase so a cluster doesn't breathe in lockstep.
    this.setStateImmediate('idle');
    this.mixer.setTime(unitHash(citizenId, 'phase') * 2);
    this.object.visible = true;
    return this;
  }

  release() {
    this.inUse = false;
    this.citizenId = null;
    this.object.visible = false;
  }

  setPositionYaw(x, y, z, yaw) {
    this.object.position.set(x, y, z);
    this.object.rotation.y = yaw;
  }

  /** Snap to a state with no crossfade (used on assign). */
  setStateImmediate(state) {
    for (const [name, action] of Object.entries(this.actions)) {
      action.setEffectiveWeight(name === state ? 1 : 0);
    }
    this.state = state;
  }

  setState(state) {
    if (state === this.state) return;
    const next = this.actions[state];
    const prev = this.actions[this.state];
    if (next) {
      next.reset();
      next.setEffectiveWeight(1);
      next.fadeIn(CROSSFADE_S);
      next.play();
    }
    if (prev) prev.fadeOut(CROSSFADE_S);
    this.state = state;
  }

  update(delta) {
    this.mixer.update(delta);
  }

  dispose() {
    this.mixer.stopAllAction();
    for (const m of this._materials) m.dispose();
  }
}
