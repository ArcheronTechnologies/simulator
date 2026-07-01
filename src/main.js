import * as THREE from 'three';
import './verify/smoke.js';
import { Engine } from './core/Engine.js';
import { markReady } from './verify/smoke.js';
import { isKeyDown } from './core/Input.js';
import { TileManager } from './world/TileManager.js';
import { projection, TILE_SIZE_M, LOAD_RADIUS, DISPOSE_RADIUS, FOG_COLOR, FOG_NEAR, FOG_FAR, SPAWN_LATLON } from './config.js';

const container = document.getElementById('app');
const engine = new Engine(container);

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x2b2418, 1.1);
engine.scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.set(300, 500, 200);
sun.target.position.set(0, 0, 0);
engine.scene.add(sun);
engine.scene.add(sun.target);

engine.scene.background = new THREE.Color(FOG_COLOR);
engine.scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
engine.camera.far = FOG_FAR + 200;
engine.camera.updateProjectionMatrix();

// Large flat ground plane so gaps between not-yet-loaded tiles never show
// the void. Sits fractionally below y=0 so it never z-fights real tiles.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(20000, 20000),
  new THREE.MeshStandardMaterial({ color: 0x4a5240 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.05;
engine.scene.add(ground);

// --- Temporary free-fly debug camera (WASD + arrow-key yaw, Space/Shift for
// up/down) to prove tile streaming works before the real third-person
// character + FollowCamera land in later steps. ---
const spawn = projection.project(SPAWN_LATLON.lat, SPAWN_LATLON.lon);
engine.camera.position.set(spawn.x, 80, spawn.z + 150);
let yaw = Math.PI; // facing back toward spawn (-Z is "forward" at yaw=0)

function updateFreeCam(delta) {
  const turnSpeed = 1.6; // rad/s
  if (isKeyDown('ArrowLeft')) yaw += turnSpeed * delta;
  if (isKeyDown('ArrowRight')) yaw -= turnSpeed * delta;

  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
  const speed = (isKeyDown('ShiftLeft') || isKeyDown('ShiftRight') ? 220 : 60) * delta;

  if (isKeyDown('KeyW')) engine.camera.position.addScaledVector(forward, speed);
  if (isKeyDown('KeyS')) engine.camera.position.addScaledVector(forward, -speed);
  if (isKeyDown('KeyD')) engine.camera.position.addScaledVector(right, speed);
  if (isKeyDown('KeyA')) engine.camera.position.addScaledVector(right, -speed);
  if (isKeyDown('Space')) engine.camera.position.y += speed;
  if (isKeyDown('ControlLeft')) engine.camera.position.y -= speed;

  engine.camera.rotation.set(-0.25, yaw, 0, 'YXZ');
}

const tileManager = new TileManager(engine.scene, {
  tileSize: TILE_SIZE_M,
  loadRadius: LOAD_RADIUS,
  disposeRadius: DISPOSE_RADIUS,
});

let firstTileLoaded = false;
const readyPromise = new Promise((resolve) => {
  tileManager.onTileLoaded = () => {
    if (!firstTileLoaded) {
      firstTileLoaded = true;
      resolve();
    }
  };
});

engine.onUpdate((delta) => {
  updateFreeCam(delta);
  tileManager.update(engine.camera.position.x, engine.camera.position.z);
});

window.__debugTileManager = tileManager; // for headless verification (tile counts)

tileManager
  .init()
  .then(() => {
    tileManager.update(engine.camera.position.x, engine.camera.position.z);
    return readyPromise;
  })
  .catch((err) => console.error('[main] tile manager init failed', err))
  .finally(() => markReady());

engine.start();
