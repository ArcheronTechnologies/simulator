// Exposes minimal window hooks so headless verification (Playwright) can
// observe app health without a UI. Populated further as systems come online.
window.__ERRORS__ = [];
window.__READY__ = false;

window.addEventListener('error', (e) => {
  window.__ERRORS__.push(String(e.error?.stack || e.message || e));
});
window.addEventListener('unhandledrejection', (e) => {
  window.__ERRORS__.push(String(e.reason?.stack || e.reason || 'unhandledrejection'));
});

export function markReady() {
  window.__READY__ = true;
}
