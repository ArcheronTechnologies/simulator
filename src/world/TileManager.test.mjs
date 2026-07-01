import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestRoadName } from './TileManager.js';

test('nearestRoadName finds the closest point across multiple road lists', () => {
  const roadLists = [
    [{ n: 'Paradisgatan', p: [0, 0, 10, 0] }],
    [{ n: 'Sandgatan', p: [100, 100] }],
  ];
  assert.equal(nearestRoadName(roadLists, 1, 0.5, 60), 'Paradisgatan');
});

test('nearestRoadName respects maxDist and returns null when nothing is close enough', () => {
  const roadLists = [[{ n: 'Paradisgatan', p: [0, 0] }]];
  assert.equal(nearestRoadName(roadLists, 1000, 1000, 60), null);
});

test('nearestRoadName returns null for empty input', () => {
  assert.equal(nearestRoadName([], 0, 0, 60), null);
  assert.equal(nearestRoadName([[]], 0, 0, 60), null);
});

test('nearestRoadName picks the nearer of two overlapping-range roads', () => {
  const roadLists = [
    [
      { n: 'Far Street', p: [50, 0] },
      { n: 'Near Street', p: [5, 0] },
    ],
  ];
  assert.equal(nearestRoadName(roadLists, 0, 0, 60), 'Near Street');
});
