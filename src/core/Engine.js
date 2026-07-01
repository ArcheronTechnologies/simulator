import * as THREE from 'three';

export class Engine {
  constructor(container) {
    this.container = container;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    this.camera.position.set(0, 5, 10);

    // preserveDrawingBuffer: WebGL clears the drawing buffer after each
    // composited frame by default, so out-of-loop pixel reads (headless
    // verification screenshots, in-game photo mode) would see a blank
    // buffer without this.
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this._updateFns = [];
    this._running = false;

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  onUpdate(fn) {
    this._updateFns.push(fn);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this.renderer.setAnimationLoop((timestamp) => this._tick(timestamp));
  }

  stop() {
    this._running = false;
    this.renderer.setAnimationLoop(null);
  }

  _tick(timestamp) {
    this.timer.update(timestamp);
    const delta = Math.min(this.timer.getDelta(), 0.1);
    const elapsed = this.timer.getElapsed();
    for (const fn of this._updateFns) fn(delta, elapsed);
    this.renderer.render(this.scene, this.camera);
  }
}
