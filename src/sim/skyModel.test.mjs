import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skyStateForHour, lerpColorHex, isNight } from './skyModel.js';

test('noon is bright and high, midnight is dark and low', () => {
  const noon = skyStateForHour(12);
  const midnight = skyStateForHour(0);
  assert.ok(noon.sunIntensity > 1.5, `noon sun ${noon.sunIntensity}`);
  assert.ok(noon.sunElevation > 0.9, `noon elevation ${noon.sunElevation}`);
  assert.ok(midnight.sunIntensity < 0.1, `midnight sun ${midnight.sunIntensity}`);
  assert.ok(midnight.sunElevation < 0, `midnight elevation ${midnight.sunElevation}`);
});

test('sun elevation is 0 around sunrise (6) and sunset (18)', () => {
  assert.ok(Math.abs(skyStateForHour(6).sunElevation) < 1e-9);
  assert.ok(Math.abs(skyStateForHour(18).sunElevation) < 1e-9);
});

test('isNight matches sun elevation', () => {
  assert.equal(isNight(2), true);
  assert.equal(isNight(12), false);
  assert.equal(isNight(23), true);
});

test('all outputs are finite and in range across the whole day', () => {
  for (let h = 0; h < 24; h += 0.25) {
    const s = skyStateForHour(h);
    assert.ok(Number.isFinite(s.sunIntensity) && s.sunIntensity >= 0);
    assert.ok(Number.isFinite(s.hemiIntensity) && s.hemiIntensity >= 0);
    assert.ok(s.sunElevation >= -1 && s.sunElevation <= 1);
    for (const c of [s.skyColor, s.groundColor, s.sunColor]) {
      assert.ok(c >= 0 && c <= 0xffffff, `colour out of range at h=${h}: ${c}`);
    }
  }
});

test('hour wraps (24 == 0, negative ok)', () => {
  assert.deepEqual(skyStateForHour(24), skyStateForHour(0));
  assert.deepEqual(skyStateForHour(-2), skyStateForHour(22));
});

test('lerpColorHex interpolates channelwise', () => {
  assert.equal(lerpColorHex(0x000000, 0xffffff, 0), 0x000000);
  assert.equal(lerpColorHex(0x000000, 0xffffff, 1), 0xffffff);
  assert.equal(lerpColorHex(0x000000, 0xffffff, 0.5), 0x808080);
  assert.equal(lerpColorHex(0xff0000, 0x0000ff, 0.5), 0x800080);
});

test('colours change through the day (dawn warm vs noon cool)', () => {
  const dawn = skyStateForHour(7);
  const noon = skyStateForHour(12);
  assert.notEqual(dawn.skyColor, noon.skyColor);
  // Dawn sky should be warmer (more red than blue) than noon.
  const dawnR = (dawn.skyColor >> 16) & 0xff;
  const dawnB = dawn.skyColor & 0xff;
  assert.ok(dawnR > dawnB, 'dawn sky should be warm (R>B)');
});
