import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyByTags,
  landuseKindAt,
  classifyBuilding,
} from './classify_buildings.mjs';

test('residential building types are homes', () => {
  assert.deepEqual(classifyByTags({ building: 'house' }), { kind: 'home', subtype: 'house', name: null });
  assert.equal(classifyByTags({ building: 'apartments' }).kind, 'home');
  assert.equal(classifyByTags({ building: 'apartments' }).subtype, 'apartments');
  assert.equal(classifyByTags({ building: 'detached' }).subtype, 'house');
});

test('workplace building types are work with subtype', () => {
  assert.equal(classifyByTags({ building: 'school' }).subtype, 'school');
  assert.equal(classifyByTags({ building: 'university' }).subtype, 'university');
  assert.equal(classifyByTags({ building: 'retail' }).subtype, 'retail');
  assert.equal(classifyByTags({ building: 'office' }).subtype, 'office');
  assert.equal(classifyByTags({ building: 'industrial' }).subtype, 'industrial');
});

test('POI tags on a generic building=yes make it a workplace', () => {
  // These mirror real cached Lund tag combinations.
  assert.deepEqual(classifyByTags({ building: 'yes', shop: 'convenience', name: 'Quick Corner' }),
    { kind: 'work', subtype: 'retail', name: 'Quick Corner' });
  assert.equal(classifyByTags({ building: 'yes', amenity: 'library', name: 'Veberöds bibliotek' }).subtype, 'civic');
  assert.equal(classifyByTags({ building: 'yes', amenity: 'restaurant' }).subtype, 'retail');
  assert.equal(classifyByTags({ building: 'yes', office: 'company' }).subtype, 'office');
});

test('garages, sheds, and churches are skipped', () => {
  assert.equal(classifyByTags({ building: 'garage' }).kind, 'skip');
  assert.equal(classifyByTags({ building: 'shed' }).kind, 'skip');
  assert.equal(classifyByTags({ building: 'church', amenity: 'place_of_worship' }).kind, 'skip');
  assert.equal(classifyByTags({ building: 'roof' }).kind, 'skip');
});

test('a workplace amenity inside a skipped building type is still honoured', () => {
  // building=yes + place_of_worship is skip, but a community_centre works.
  assert.equal(classifyByTags({ building: 'chapel', amenity: 'community_centre' }).kind, 'work');
});

test('a plain building=yes is unknown (resolved later by landuse)', () => {
  assert.equal(classifyByTags({ building: 'yes' }).kind, 'unknown');
});

test('no building tag is skipped', () => {
  assert.equal(classifyByTags({ amenity: 'bench' }).kind, 'skip');
});

const residentialZone = { kind: 'residential', rings: [[[0, 0], [100, 0], [100, 100], [0, 100]]] };
const workZone = { kind: 'workplace', rings: [[[200, 0], [300, 0], [300, 100], [200, 100]]] };

test('landuseKindAt resolves containment and respects holes', () => {
  assert.equal(landuseKindAt([residentialZone, workZone], 50, 50), 'residential');
  assert.equal(landuseKindAt([residentialZone, workZone], 250, 50), 'workplace');
  assert.equal(landuseKindAt([residentialZone, workZone], 150, 50), null);
  const withHole = { kind: 'residential', rings: [[[0, 0], [100, 0], [100, 100], [0, 100]], [[40, 40], [60, 40], [60, 60], [40, 60]]] };
  assert.equal(landuseKindAt([withHole], 50, 50), null); // inside the hole
  assert.equal(landuseKindAt([withHole], 10, 10), 'residential');
});

test('classifyBuilding resolves unknown via landuse, defaults to home', () => {
  const zones = [residentialZone, workZone];
  assert.equal(classifyBuilding({ building: 'yes' }, [50, 50], zones).kind, 'home');
  assert.equal(classifyBuilding({ building: 'yes' }, [250, 50], zones).kind, 'work');
  // Outside any zone -> residential default.
  assert.equal(classifyBuilding({ building: 'yes' }, [1000, 1000], zones).kind, 'home');
});

test('classifyBuilding lets explicit tags override landuse', () => {
  // A shop sitting in a residential zone is still a workplace.
  assert.equal(classifyBuilding({ building: 'yes', shop: 'bakery' }, [50, 50], [residentialZone]).kind, 'work');
});
