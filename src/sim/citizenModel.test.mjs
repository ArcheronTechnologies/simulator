import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadCitizenModel, isCitizenModelLoaded, _resetCitizenModel } from './citizenModel.js';

// loadAsync() is inherited (wraps .load() in a promise), so .load() is the
// real per-instance async entry point and the correct thing to mock.

test('loadCitizenModel rejects on failure and does not poison future retries', async () => {
  _resetCitizenModel();
  const failing = mock.method(GLTFLoader.prototype, 'load', (url, onLoad, onProgress, onError) => {
    onError(new Error('simulated network failure'));
  });
  await assert.rejects(() => loadCitizenModel(), /simulated network failure/);
  assert.equal(isCitizenModelLoaded(), false);
  failing.mock.restore();

  const fakeGltf = { scene: {}, animations: [] };
  mock.method(GLTFLoader.prototype, 'load', (url, onLoad) => onLoad(fakeGltf));
  const gltf = await loadCitizenModel(); // must NOT reuse the dead rejected promise
  assert.equal(gltf, fakeGltf);
  assert.equal(isCitizenModelLoaded(), true);

  _resetCitizenModel();
  mock.reset();
});

test('loadCitizenModel is idempotent once loaded (does not re-fetch)', async () => {
  _resetCitizenModel();
  let calls = 0;
  mock.method(GLTFLoader.prototype, 'load', (url, onLoad) => {
    calls++;
    onLoad({ scene: {}, animations: [] });
  });
  await loadCitizenModel();
  await loadCitizenModel();
  assert.equal(calls, 1);

  _resetCitizenModel();
  mock.reset();
});
