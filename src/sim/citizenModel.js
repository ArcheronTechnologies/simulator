import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

// Loads the shared character glTF EXACTLY ONCE and hands out skeleton clones
// for citizen bodies. Loading the 4MB asset per NPC would be ruinous; the
// SkeletonUtils clone shares geometry/animation data while giving each body its
// own posable skeleton. Reuses the same CC0 Quaternius model as the player.
const MODEL_URL = './assets/AnimationLibrary_Godot_Standard.gltf';

export const CITIZEN_CLIPS = { idle: 'Idle_Loop', walk: 'Walk_Loop' };

let _gltf = null;
let _loading = null;

/** Load (or return the cached) shared glTF. Idempotent. */
export function loadCitizenModel() {
  if (_gltf) return Promise.resolve(_gltf);
  if (!_loading) {
    _loading = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
      _gltf = gltf;
      return gltf;
    });
  }
  return _loading;
}

export function isCitizenModelLoaded() {
  return _gltf != null;
}

/**
 * A fresh skeleton clone of the character, reduced to a single skinned mesh
 * (the model ships a second "joint markers" mesh we don't want — dropping it
 * halves per-body draw calls and triangles). Materials are cloned so each body
 * can be tinted independently.
 */
export function makeCitizenClone() {
  if (!_gltf) throw new Error('citizen model not loaded — call loadCitizenModel() first');
  const root = skeletonClone(_gltf.scene);

  // Keep only the largest skinned mesh; remove the rest (joint-marker mesh).
  const skinned = [];
  root.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  if (skinned.length > 1) {
    skinned.sort((a, b) => (b.geometry.attributes.position?.count || 0) - (a.geometry.attributes.position?.count || 0));
    for (let i = 1; i < skinned.length; i++) skinned[i].removeFromParent();
  }

  // Clone materials per body for independent tinting; disable frustum culling
  // (animated skinned bounds drift from the bind pose and can cull wrongly).
  const materials = [];
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.material = o.material.clone();
      o.frustumCulled = false;
      materials.push(o.material);
    }
  });

  return { root, materials, animations: _gltf.animations };
}

/** For tests/tools: reset the module-level cache (not used in the app). */
export function _resetCitizenModel() {
  _gltf = null;
  _loading = null;
}

// Re-export so callers don't need a direct THREE import just for the mixer.
export { THREE };
