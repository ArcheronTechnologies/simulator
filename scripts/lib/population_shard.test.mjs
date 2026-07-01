import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeShard,
  deserializeShard,
  serializeWorkIndex,
  deserializeWorkIndex,
} from './population_shard.mjs';

const citizens = [
  { id: 5, arch: 0, homeXZ: [10.123, -20.456], homeTile: '0_-1', workXZ: [300.5, 400.25], workTile: '0_0', leisureXZ: [0, 0] },
  { id: 6, arch: 3, homeXZ: [11, -21], homeTile: '0_-1', workXZ: [11, -21], workTile: '0_-1', leisureXZ: [50, 50] },
];

test('shard round-trips to meter precision', () => {
  const back = deserializeShard(serializeShard(citizens));
  assert.equal(back.length, 2);
  assert.equal(back[0].id, 5);
  assert.equal(back[0].arch, 0);
  assert.ok(Math.abs(back[0].homeXZ[0] - 10) < 0.51);
  assert.ok(Math.abs(back[0].workXZ[1] - 400) < 0.51);
  assert.deepEqual(back[1].leisureXZ, [50, 50]);
});

test('shard omits workTile (derivable at runtime)', () => {
  const s = serializeShard(citizens);
  assert.equal(s.workTile, undefined);
  assert.equal(deserializeShard(s)[0].workTile, undefined);
});

test('shard is columnar (parallel arrays, count matches)', () => {
  const s = serializeShard(citizens);
  assert.equal(s.count, 2);
  assert.equal(s.id.length, 2);
  assert.equal(s.homeXZ.length, 4); // 2 citizens x (x,z)
  assert.equal(s.workXZ.length, 4);
});

test('empty shard round-trips', () => {
  assert.deepEqual(deserializeShard(serializeShard([])), []);
});

test('work index carries id, arch, and both anchors', () => {
  const back = deserializeWorkIndex(serializeWorkIndex(citizens));
  assert.equal(back.length, 2);
  assert.equal(back[0].id, 5);
  assert.ok(Math.abs(back[0].workXZ[0] - 300.5) < 0.51); // meter precision
  assert.ok(Math.abs(back[0].homeXZ[0] - 10.123) < 0.51);
  assert.equal(back[0].arch, 0);
});

test('serialized shard is JSON-stable (deterministic key order)', () => {
  assert.equal(JSON.stringify(serializeShard(citizens)), JSON.stringify(serializeShard(citizens)));
});
