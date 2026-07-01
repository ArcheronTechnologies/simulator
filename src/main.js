import * as THREE from 'three';
import './verify/smoke.js';
import { Engine } from './core/Engine.js';
import { markReady } from './verify/smoke.js';
import { buildBuildingsGeometry, buildingsMaterial } from './world/buildings.js';
import { TILE_SIZE_M } from './config.js';

const container = document.getElementById('app');
const engine = new Engine(container);

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x2b2418, 1.1);
engine.scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.set(300, 500, 200);
sun.target.position.set(0, 0, 0);
engine.scene.add(sun);
engine.scene.add(sun.target);

engine.scene.background = new THREE.Color(0xbfd9ff);

// --- Single real tile, main-thread build, to visually validate extrusion
// before the tile streaming manager + worker land (later step). ---
const TILE_KEY = '-22_-11'; // covers Lund Cathedral
const [tx, tz] = TILE_KEY.split('_').map(Number);
const tileCenterX = (tx + 0.5) * TILE_SIZE_M;
const tileCenterZ = (tz + 0.5) * TILE_SIZE_M;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(TILE_SIZE_M, TILE_SIZE_M),
  new THREE.MeshStandardMaterial({ color: 0x4a5240 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(tileCenterX, 0, tileCenterZ);
engine.scene.add(ground);

engine.camera.position.set(tileCenterX - 180, 160, tileCenterZ + 220);
engine.camera.lookAt(tileCenterX, 0, tileCenterZ);

fetch(`./tiles/${TILE_KEY}.json`)
  .then((res) => res.json())
  .then((tile) => {
    const geometry = buildBuildingsGeometry(tile.buildings);
    const mesh = new THREE.Mesh(geometry, buildingsMaterial);
    engine.scene.add(mesh);
    console.log(`[main] loaded tile ${TILE_KEY}: ${tile.buildings.length} buildings`);
  })
  .catch((err) => {
    console.error('[main] failed to load tile', err);
  })
  .finally(() => markReady());

engine.start();
