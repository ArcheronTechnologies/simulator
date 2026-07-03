// Shared idle/walk/run crossfade for THREE.AnimationAction sets.
export function crossfadeState(actions, currentState, nextState, durationS) {
  if (nextState === currentState) return currentState;
  const next = actions[nextState];
  const prev = actions[currentState];
  if (next) {
    next.reset();
    next.setEffectiveWeight(1); // fadeIn() only ramps existing base weight; inactive actions start at 0
    next.fadeIn(durationS);
    next.play();
  }
  if (prev) prev.fadeOut(durationS);
  return nextState;
}
