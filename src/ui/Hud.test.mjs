import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compassHeadingDeg } from './Hud.js';

test('compassHeadingDeg: yaw=0 (facing -Z, geographic north) is heading 0', () => {
  assert.equal(compassHeadingDeg(0), 0);
});

test('compassHeadingDeg: yaw=+90deg (facing -X, west) is heading 270', () => {
  assert.ok(Math.abs(compassHeadingDeg(Math.PI / 2) - 270) < 1e-9);
});

test('compassHeadingDeg: yaw=-90deg (facing +X, east) is heading 90', () => {
  assert.ok(Math.abs(compassHeadingDeg(-Math.PI / 2) - 90) < 1e-9);
});

test('compassHeadingDeg: yaw=180deg (facing +Z, south) is heading 180', () => {
  assert.ok(Math.abs(compassHeadingDeg(Math.PI) - 180) < 1e-9);
});

test('compassHeadingDeg: always returns a value in [0, 360)', () => {
  for (const yaw of [-10, -3.7, -0.001, 0, 0.001, 3.7, 10]) {
    const h = compassHeadingDeg(yaw);
    assert.ok(h >= 0 && h < 360, `heading ${h} out of range for yaw ${yaw}`);
  }
});
