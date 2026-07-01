// Full-screen gate shown until the character and its starting tile are
// ready. A visible loading state matters here specifically because the
// first few seconds involve real network fetches (manifest, tile JSON,
// the character model) -- unlike a bundled game asset, these can
// genuinely take a moment depending on connection speed.
export class LoadingScreen {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; inset: 0; z-index: 100;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: #0b0d10; color: #e8e4da; font-family: system-ui, sans-serif;
      transition: opacity 0.5s ease;
    `;
    this.el.innerHTML = `
      <div style="font-size: 1.4rem; letter-spacing: 0.08em; margin-bottom: 0.75rem;">LUND</div>
      <div style="font-size: 0.85rem; opacity: 0.7;">streaming the city…</div>
    `;
    document.body.appendChild(this.el);
  }

  hide() {
    this.el.style.opacity = '0';
    setTimeout(() => this.el.remove(), 550);
  }
}
