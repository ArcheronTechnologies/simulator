import * as THREE from 'three';
import './core/bvhSetup.js';
import './verify/smoke.js';
import { Engine } from './core/Engine.js';
import { markReady } from './verify/smoke.js';
import { TileManager } from './world/TileManager.js';
import { Character } from './player/Character.js';
import { Collider } from './player/Collider.js';
import { Controller } from './player/Controller.js';
import { FollowCamera } from './player/FollowCamera.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { Hud } from './ui/Hud.js';
import { GameClock } from './sim/GameClock.js';
import { SkyController } from './sim/SkyController.js';
import { loadCitizenModel } from './sim/citizenModel.js';
import { CitizenBodyPool } from './sim/CitizenBodyPool.js';
import { PopulationStore } from './sim/PopulationStore.js';
import { PopulationManager } from './sim/PopulationManager.js';
import {
  projection, TILE_SIZE_M, LOAD_RADIUS, DISPOSE_RADIUS, FOG_COLOR, FOG_NEAR, FOG_FAR, SPAWN_LATLON,
  DAY_LENGTH_MINUTES, START_HOUR, START_DAY, MAX_RENDERED_CITIZENS,
  CITIZEN_POP_BASE_URL, CITIZEN_ACTIVATION_RADIUS_M, CITIZEN_RELEASE_RADIUS_M,
} from './config.js';

const loadingScreen = new LoadingScreen();

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

// Time of day + dynamic day/night sky (drives the sun, light colour, and fog
// tint each frame). Reuses the hemi/sun lights created above.
const gameClock = new GameClock({ dayLengthMinutes: DAY_LENGTH_MINUTES, startHour: START_HOUR, startDay: START_DAY });
const skyController = new SkyController(engine.scene, { sun, hemi, fog: engine.scene.fog });

const spawn = projection.project(SPAWN_LATLON.lat, SPAWN_LATLON.lon);
engine.camera.position.set(spawn.x, 2.5, spawn.z + 8);
engine.camera.lookAt(spawn.x, 1.4, spawn.z);

// Large flat ground plane, both visual (fills gaps between not-yet-loaded
// tiles) and a collider (stops the player falling through gaps/before the
// first tile streams in). Sits fractionally below y=0 so it never
// z-fights real tile geometry.
const collider = new Collider(TILE_SIZE_M);
// Rotation/offset baked into the geometry itself (not the mesh transform)
// so its BVH -- computed on raw local-space vertex data -- lives directly
// in world space, matching every other collider mesh in the scene (which
// all sit at identity transform already). Sized to cover the whole
// municipality bbox (corners up to ~+-15.9km/+-15km from the local origin,
// which sits at the bbox midpoint, not at the spawn point) with margin.
// Subdivided into reasonably-sized triangles rather than one giant quad --
// keeps the BVH's node bounds tight, which matters now that Controller
// relies on capsuleCollision.js's supplementary piercing check.
const groundGeometry = new THREE.PlaneGeometry(40000, 40000, 80, 80);
groundGeometry.rotateX(-Math.PI / 2);
groundGeometry.translate(0, -0.05, 0);
const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({ color: 0x4a5240 }));
engine.scene.add(ground);
collider.setGround(ground);

// Population lives behind the same tile lifecycle as collision: when a tile's
// geometry loads/unloads, its citizens activate/deactivate too.
const populationStore = new PopulationStore({ baseUrl: CITIZEN_POP_BASE_URL, tileSize: TILE_SIZE_M });
let population = null; // created once the citizen model has loaded

const tileManager = new TileManager(engine.scene, {
  tileSize: TILE_SIZE_M,
  loadRadius: LOAD_RADIUS,
  disposeRadius: DISPOSE_RADIUS,
  onTileLoaded: (key, meshes) => {
    collider.addTile(key, meshes.buildings);
    if (population) population.onTileLoaded(key);
  },
  onTileUnloaded: (key) => {
    collider.removeTile(key);
    if (population) population.onTileUnloaded(key);
  },
});

const character = new Character();
const followCamera = new FollowCamera(engine.camera, engine.renderer.domElement);
const hud = new Hud(engine.renderer);
let controller = null;

engine.onUpdate((delta) => {
  const px = controller ? controller.position.x : spawn.x;
  const pz = controller ? controller.position.z : spawn.z;
  tileManager.update(px, pz);
  gameClock.update(delta);
  skyController.update(gameClock);

  if (population) population.update(delta, px, pz);

  if (controller) {
    controller.update(delta, followCamera.yaw);
    followCamera.update(controller.position, collider.nearbyColliders(px, pz), delta);
    hud.update(delta, {
      position: controller.position, cameraYaw: followCamera.yaw, tileManager, clock: gameClock,
      citizenCount: population ? population.renderedCount : null,
    });
  } else {
    character.update(delta);
  }
});

// Time-of-day controls: [ / ] adjust speed, P pauses.
const TIME_SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
let timeSpeedIndex = 2;
window.addEventListener('keydown', (e) => {
  if (e.code === 'BracketRight') {
    timeSpeedIndex = Math.min(TIME_SPEEDS.length - 1, timeSpeedIndex + 1);
    gameClock.setSpeed(TIME_SPEEDS[timeSpeedIndex]);
  } else if (e.code === 'BracketLeft') {
    timeSpeedIndex = Math.max(0, timeSpeedIndex - 1);
    gameClock.setSpeed(TIME_SPEEDS[timeSpeedIndex]);
  } else if (e.code === 'KeyP') {
    gameClock.togglePause();
  }
});

window.__debugCharacter = character;
window.__debugTileManager = tileManager; // for headless verification (tile counts)
window.__debugCollider = collider;
window.__debugFollowCamera = followCamera;
window.__debugGameClock = gameClock; // for headless verification (time of day)
window.__debugSky = skyController;
window.__engine = engine; // for headless verification (camera control, screenshots)

let firstTileLoaded = false;
const firstTilePromise = new Promise((resolve) => {
  const prevOnLoaded = tileManager.onTileLoaded;
  tileManager.onTileLoaded = (key, meshes) => {
    prevOnLoaded(key, meshes);
    if (!firstTileLoaded) {
      firstTileLoaded = true;
      resolve();
    }
  };
});

// Citizens are an enhancement, not a requirement to play: public/assets/*.gltf
// is git-ignored and only produced by a separate `npm run fetch:character`
// step (not mentioned in the README's basic setup), so a fresh clone with no
// character asset must still leave the player controllable -- exactly what
// character.load()'s own capsule fallback already guarantees for the player.
// Isolating the citizen group in its own catch means its rejection can never
// reach coreReady's Promise.all below.
const coreReady = Promise.all([tileManager.init(), character.load()]);
const populationReady = Promise.all([loadCitizenModel(), populationStore.init()])
  .then(() => true)
  .catch((err) => {
    // console.warn, not console.error: this is a handled, non-fatal path --
    // verify.mjs treats console.error as a page-error signal, and a warning
    // correctly signals "degraded but working" instead of "broken".
    console.warn('[main] citizen population failed to load — continuing with no citizens:', err);
    return false;
  });

Promise.all([coreReady, populationReady])
  .then(([, hasPopulation]) => {
    engine.scene.add(character.object);
    controller = new Controller(character, collider);
    controller.setPosition(spawn.x, 0, spawn.z);
    window.__debugController = controller;

    if (hasPopulation) {
      // The citizen model is loaded, so the pooled bodies can be built now.
      const citizenPool = new CitizenBodyPool(engine.scene, MAX_RENDERED_CITIZENS);
      population = new PopulationManager({
        store: populationStore,
        pool: citizenPool,
        clock: gameClock,
        tileManager,
        activationRadius: CITIZEN_ACTIVATION_RADIUS_M,
        releaseRadius: CITIZEN_RELEASE_RADIUS_M,
        capacity: MAX_RENDERED_CITIZENS,
        tileSize: TILE_SIZE_M,
      });
      window.__debugPopulation = population;
      window.__debugCitizenPool = citizenPool;

      // Any tiles that streamed in before the population existed need activating.
      for (const key of tileManager.loaded.keys()) population.onTileLoaded(key);
    }

    tileManager.update(spawn.x, spawn.z);
    return firstTilePromise;
  })
  .catch((err) => console.error('[main] startup failed', err))
  .finally(() => {
    loadingScreen.hide();
    markReady();
  });

engine.start();
