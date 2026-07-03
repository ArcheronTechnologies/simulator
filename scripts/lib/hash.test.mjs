import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash32, unitHash, rangeHash, makeRng } from './hash.mjs';

test('hash32 is deterministic for the same input', () => {
  assert.equal(hash32(42, 'wake'), hash32(42, 'wake'));
  assert.equal(hash32('abc'), hash32('abc'));
});

test('hash32 returns a uint32', () => {
  for (const id of [0, 1, 999, 123456]) {
    const h = hash32(id, 'x');
    assert.ok(Number.isInteger(h));
    assert.ok(h >= 0 && h <= 0xffffffff);
  }
});

test('different salts give independent values for the same id', () => {
  // Not merely distinct — should not be trivially correlated. Check that a
  // batch of ids produces different orderings under two salts.
  assert.notEqual(hash32(7, 'wake'), hash32(7, 'leave'));
  let agree = 0;
  for (let id = 0; id < 100; id++) {
    if (unitHash(id, 'a') < 0.5 === unitHash(id, 'b') < 0.5) agree++;
  }
  // If salts were correlated this would be ~100; independent ~50.
  assert.ok(agree > 25 && agree < 75, `salts look correlated (agree=${agree})`);
});

test('unitHash is in [0, 1)', () => {
  for (let id = 0; id < 1000; id++) {
    const u = unitHash(id, 's');
    assert.ok(u >= 0 && u < 1, `out of range: ${u}`);
  }
});

test('unitHash is roughly uniform', () => {
  const buckets = new Array(10).fill(0);
  const N = 20000;
  for (let id = 0; id < N; id++) buckets[Math.floor(unitHash(id, 'u') * 10)]++;
  const expected = N / 10;
  for (const b of buckets) {
    assert.ok(Math.abs(b - expected) < expected * 0.15, `bucket ${b} far from ${expected}`);
  }
});

test('rangeHash stays within [min, max)', () => {
  for (let id = 0; id < 500; id++) {
    const v = rangeHash(id, 'wake', -30, 30);
    assert.ok(v >= -30 && v < 30);
  }
});

test('makeRng is deterministic and in [0, 1)', () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test('makeRng with different seeds diverges', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  assert.notEqual(a(), b());
});
