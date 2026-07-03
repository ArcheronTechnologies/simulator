import * as THREE from 'three';
import { skyStateForHour } from './skyModel.js';

// Drives the day/night cycle: sun arc, light colour/intensity, and sky/fog
// tint, all from the GameClock. Reuses the existing hemisphere + directional
// lights created in main.js rather than adding new ones. The pure colour/angle
// math lives in skyModel.js so it can be unit-tested without THREE.
export class SkyController {
  /**
   * @param {THREE.Scene} scene
   * @param {object} refs
   * @param {THREE.DirectionalLight} refs.sun
   * @param {THREE.HemisphereLight} refs.hemi
   * @param {THREE.Fog} refs.fog
   */
  constructor(scene, { sun, hemi, fog }) {
    this.scene = scene;
    this.sun = sun;
    this.hemi = hemi;
    this.fog = fog;

    this._skyColor = new THREE.Color();
    this._sunColor = new THREE.Color();
    this._hemiSky = new THREE.Color();
    this._hemiGround = new THREE.Color();
    this._sunDir = new THREE.Vector3();
  }

  update(clock) {
    const s = skyStateForHour(clock.hours);

    // Sun position on an east->overhead->west arc. `elevation` in [-1,1]
    // (1 = noon zenith, negative = below horizon at night).
    this._sunDir.set(Math.cos(s.sunAzimuth), s.sunElevation, Math.sin(s.sunAzimuth)).normalize();
    this.sun.position.copy(this._sunDir).multiplyScalar(600);
    this.sun.target.position.set(0, 0, 0);
    this.sun.intensity = s.sunIntensity;
    this.sun.color.setHex(s.sunColor);

    this.hemi.intensity = s.hemiIntensity;
    this.hemi.color.setHex(s.skyColor);
    this.hemi.groundColor.setHex(s.groundColor);

    this._skyColor.setHex(s.skyColor);
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.copy(this._skyColor);
    } else {
      this.scene.background = this._skyColor.clone();
    }
    if (this.fog) this.fog.color.copy(this._skyColor);
  }
}
