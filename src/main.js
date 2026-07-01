import * as THREE from 'three';
import './verify/smoke.js';
import { Engine } from './core/Engine.js';
import { markReady } from './verify/smoke.js';

const container = document.getElementById('app');
const engine = new Engine(container);

// Placeholder scene content — proves the render pipeline works end to end.
// Replaced by streamed world geometry + character in later steps.
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x2b2418, 1.1);
engine.scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.set(30, 50, 20);
engine.scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x3a3f33 })
);
ground.rotation.x = -Math.PI / 2;
engine.scene.add(ground);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshStandardMaterial({ color: 0xc9502e })
);
box.position.set(0, 1, 0);
engine.scene.add(box);

engine.camera.position.set(6, 4, 8);
engine.camera.lookAt(box.position);

engine.onUpdate((delta) => {
  box.rotation.y += delta * 0.6;
});

engine.start();
markReady();
