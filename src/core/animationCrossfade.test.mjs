import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { crossfadeState } from './animationCrossfade.js';

// Two single-track clips driving the same dummy property, mirroring how
// Character.js/CitizenBody.js build one AnimationMixer per object with one
// action per movement state.
function makeActions() {
  const root = new THREE.Object3D();
  const mixer = new THREE.AnimationMixer(root);
  const idleClip = new THREE.AnimationClip('idle', 1, [new THREE.NumberKeyframeTrack('.rotation[y]', [0, 1], [0, 1])]);
  const walkClip = new THREE.AnimationClip('walk', 1, [new THREE.NumberKeyframeTrack('.rotation[y]', [0, 1], [0, 1])]);

  const idle = mixer.clipAction(idleClip);
  const walk = mixer.clipAction(walkClip);
  idle.play();
  walk.play();
  // Matches the real constructors: the starting state is fully weighted,
  // every other action begins at base weight 0.
  idle.setEffectiveWeight(1);
  walk.setEffectiveWeight(0);

  return { mixer, actions: { idle, walk } };
}

test('no-op when already in the target state', () => {
  const { actions } = makeActions();
  const result = crossfadeState(actions, 'idle', 'idle', 0.2);
  assert.equal(result, 'idle');
  assert.equal(actions.idle.getEffectiveWeight(), 1);
  assert.equal(actions.walk.getEffectiveWeight(), 0);
});

test('new action starts at full weight, not stuck ramping from a zero base weight', () => {
  const { actions } = makeActions();
  const result = crossfadeState(actions, 'idle', 'walk', 0.2);
  assert.equal(result, 'walk');
  // fadeIn() only ramps an interpolant multiplied onto the action's existing
  // *base* weight; a freshly-constructed inactive action has base weight 0
  // (set above), so without crossfadeState's setEffectiveWeight(1) call
  // first, walk would stay silently invisible for the whole fade.
  assert.equal(actions.walk.getEffectiveWeight(), 1);
});

test('previous action is mid-fade-out partway through the crossfade duration', () => {
  const { mixer, actions } = makeActions();
  const duration = 0.2;
  crossfadeState(actions, 'idle', 'walk', duration);
  mixer.update(duration / 2);
  const w = actions.idle.getEffectiveWeight();
  assert.ok(w > 0 && w < 1, `expected a partial fade-out weight partway through, got ${w}`);
});
