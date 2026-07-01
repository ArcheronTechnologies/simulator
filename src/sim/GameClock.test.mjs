import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameClock } from './GameClock.js';

test('starts at the configured hour and day', () => {
  const c = new GameClock({ startHour: 8, startDay: 1 });
  assert.equal(c.hours, 8);
  assert.equal(c.day, 1);
  assert.equal(c.formatClock(), '08:00');
});

test('advances at the configured rate (48-min day = 30x)', () => {
  const c = new GameClock({ dayLengthMinutes: 48, startHour: 0, startDay: 0 });
  // 48 real minutes = 1 game day. 1 real second = 1440/2880 = 0.5 game min.
  c.update(60); // one real minute
  assert.ok(Math.abs(c.minutesOfDay - 30) < 1e-6, `expected 30 game min, got ${c.minutesOfDay}`);
});

test('a full real day-length elapses exactly one game day', () => {
  const c = new GameClock({ dayLengthMinutes: 48, startHour: 0, startDay: 0 });
  c.update(48 * 60); // the whole real day-length in seconds
  assert.equal(c.day, 1); // rolled to next day
  assert.ok(c.minutesOfDay < 1e-6, `expected back at midnight, got ${c.minutesOfDay}`);
});

test('minutesOfDay wraps within [0,1440)', () => {
  const c = new GameClock({ startHour: 23, startDay: 0 });
  c.update(2 * 3600 * (48 / 24)); // ~ enough to cross midnight several times
  assert.ok(c.minutesOfDay >= 0 && c.minutesOfDay < 1440);
});

test('day advances and wraps weekly', () => {
  const c = new GameClock({ dayLengthMinutes: 48, startHour: 0, startDay: 6 });
  c.update(48 * 60); // +1 day from Saturday -> Sunday (0)
  assert.equal(c.day, 0);
});

test('normalizedDay is 0 at midnight, ~0.5 at noon', () => {
  const c = new GameClock({ startHour: 0 });
  assert.equal(c.normalizedDay, 0);
  c.setHour(12);
  assert.ok(Math.abs(c.normalizedDay - 0.5) < 1e-9);
});

test('pause halts advancement', () => {
  const c = new GameClock({ startHour: 8 });
  c.togglePause();
  c.update(1000);
  assert.equal(c.hours, 8);
  c.togglePause();
  c.update(60);
  assert.ok(c.hours > 8);
});

test('setSpeed scales advancement', () => {
  const slow = new GameClock({ dayLengthMinutes: 48, startHour: 0 });
  const fast = new GameClock({ dayLengthMinutes: 48, startHour: 0, speed: 4 });
  slow.update(10);
  fast.update(10);
  assert.ok(Math.abs(fast.minutesOfDay - slow.minutesOfDay * 4) < 1e-6);
});

test('formatClock zero-pads', () => {
  const c = new GameClock({ startHour: 9, startDay: 0 });
  c.setHour(9);
  assert.equal(c.formatClock(), '09:00');
  c.minutes += 5; // 09:05
  assert.equal(c.formatClock(), '09:05');
});
