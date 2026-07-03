// Minimal global keyboard-state tracker, shared by the free-fly debug
// camera (this step) and the real character controller (later).
const keysDown = new Set();

window.addEventListener('keydown', (e) => keysDown.add(e.code));
window.addEventListener('keyup', (e) => keysDown.delete(e.code));
window.addEventListener('blur', () => keysDown.clear());

export function isKeyDown(code) {
  return keysDown.has(code);
}
