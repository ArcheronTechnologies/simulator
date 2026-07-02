// Headless smoke test: builds the app, serves it, confirms it renders
// without errors, and drives real simulated keyboard input to prove the
// player can actually move (not just that the scene renders).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VITE_BIN = path.join(ROOT, 'node_modules', '.bin', 'vite');

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;

// Tracked at module scope so a timeout/failure can still clean up child
// processes — process.exit() does not kill children spawned via spawn().
let serverProc = null;
let browserRef = null;

function cleanup() {
  try { serverProc?.kill(); } catch { /* already dead */ }
  try { browserRef?.close(); } catch { /* already dead */ }
}

function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (async function poll() {
      while (Date.now() < deadline) {
        try {
          const res = await fetch(url);
          if (res.ok) return resolve();
        } catch {
          // not up yet
        }
        await sleep(300);
      }
      reject(new Error('server did not start in time'));
    })();
  });
}

async function main() {
  console.log('[verify] building...');
  await run(VITE_BIN, ['build']);

  console.log('[verify] starting preview server...');
  // Invoke the vite binary directly (not via `npx`) so the spawned process
  // *is* the server — npx forks a grandchild, which then survives
  // server.kill() and leaks a process holding the port across runs.
  const server = spawn(VITE_BIN, ['preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  serverProc = server;

  try {
    await waitForServer(URL);

    // Use the pre-installed browser binary directly rather than letting
    // Playwright resolve-by-revision — the installed `playwright` package
    // version may expect a newer Chromium revision than what's on disk,
    // which would otherwise trigger a silent, hanging download attempt.
    const browser = await chromium.launch({
      executablePath: '/opt/pw-browsers/chromium',
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    browserRef = browser;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (!res.ok()) pageErrors.push(`HTTP ${res.status()} — ${res.url()}`);
    });

    console.log('[verify] loading page...');
    await page.goto(URL, { waitUntil: 'load' });

    await page.waitForFunction(() => window.__READY__ === true, { timeout: 30000 });
    await page.waitForFunction(() => window.__debugController != null, { timeout: 15000 });

    // Real simulated key input, exercising the actual Input.js listener
    // path end to end -- not directly poking controller state.
    console.log('[verify] holding KeyW to verify the player actually moves...');
    const posBefore = await page.evaluate(() => window.__debugController.position.toArray());
    await page.keyboard.down('KeyW');
    await sleep(1500);
    await page.keyboard.up('KeyW');
    const posAfter = await page.evaluate(() => window.__debugController.position.toArray());
    const movedDist = Math.hypot(posAfter[0] - posBefore[0], posAfter[2] - posBefore[2]);

    const renderInfo = await page.evaluate(() => {
      const info = window.__engine.renderer.info;
      return { triangles: info.render.triangles, calls: info.render.calls };
    });

    // Citizens: the app starts at the morning commute, so once population
    // shards have streamed in there should be a visible crowd near spawn.
    await page.waitForFunction(
      () => window.__debugPopulation && window.__debugPopulation._activeTiles.size >= 3,
      { timeout: 15000 }
    ).catch(() => {});
    const citizens = await page.evaluate(() => {
      const p = window.__debugPopulation;
      if (!p) return { rendered: 0, activity: null };
      const pl = window.__debugController.position;
      p._reconcile(pl.x, pl.z); // deterministic populate at the current time
      return { rendered: p.renderedCount, activity: p._activityCounts };
    });

    const jsErrors = await page.evaluate(() => window.__ERRORS__ || []);
    const allErrors = [...pageErrors, ...jsErrors];

    // --- Resilience probe (F1 fix): a missing/failed character-and-citizen
    // asset (the state of a fresh clone that hasn't run `npm run
    // fetch:character`) must not break player movement, only degrade the
    // citizen crowd. Blocking the shared model URL exercises both
    // Character's own capsule fallback and PopulationManager's isolation
    // the same way a real missing asset would -- both loaders fetch the
    // exact same file.
    console.log('[verify] probing startup resilience with the character/citizen model blocked...');
    const resilienceContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const resiliencePage = await resilienceContext.newPage();
    const resilienceErrors = [];
    const EXPECTED_ERROR_SUBSTRINGS = [
      '[Character] model load failed', // Character's own pre-existing, unrelated fallback log
      'net::ERR_FAILED', // Chromium's own network-layer log for the request this probe deliberately aborts
    ];
    resiliencePage.on('pageerror', (err) => resilienceErrors.push(String(err)));
    resiliencePage.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (EXPECTED_ERROR_SUBSTRINGS.some((s) => text.includes(s))) return;
      resilienceErrors.push(text);
    });
    await resiliencePage.route('**/AnimationLibrary_Godot_Standard.gltf', (route) => route.abort());
    await resiliencePage.goto(URL, { waitUntil: 'load' });
    await resiliencePage.waitForFunction(() => window.__READY__ === true, { timeout: 30000 });
    await resiliencePage.waitForFunction(() => window.__debugController != null, { timeout: 15000 });

    const resilienceState = await resiliencePage.evaluate(() => ({
      hasPopulation: window.__debugPopulation != null,
      isFallbackCharacter: window.__debugCharacter?._isFallback === true,
    }));
    await resilienceContext.close();
    console.log('[verify] resilience probe:', resilienceState, 'errors:', resilienceErrors);

    await page.screenshot({ path: 'scripts/.verify-screenshot.png' });
    const isNonBlack = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return false;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return false;
      const pixels = new Uint8Array(4);
      gl.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels[0] + pixels[1] + pixels[2] > 0;
    });

    await browser.close();

    console.log('[verify] errors:', allErrors);
    console.log('[verify] non-black center pixel:', isNonBlack);
    console.log(`[verify] player moved ${movedDist.toFixed(2)}m holding KeyW for 1.5s`);
    console.log('[verify] render info:', renderInfo);
    console.log(`[verify] citizens rendered near spawn (08:00): ${citizens.rendered}`, citizens.activity || '');

    const failures = [];
    if (!resilienceState.isFallbackCharacter) {
      failures.push('Resilience probe: Character did not fall back to the capsule when its model was blocked (probe not exercising the intended path).');
    }
    if (resilienceState.hasPopulation) {
      failures.push('Resilience probe: population was still constructed despite the citizen model being blocked.');
    }
    if (resilienceErrors.length > 0) {
      failures.push(`Resilience probe reported ${resilienceErrors.length} unexpected error(s): ${resilienceErrors.join(' | ')}`);
    }
    if (citizens.rendered <= 0) {
      failures.push('No citizens rendered near spawn at the morning commute — population pipeline likely broken.');
    }
    if (allErrors.length > 0) {
      failures.push(`Page reported ${allErrors.length} error(s): ${allErrors.join(' | ')}`);
    }
    if (!isNonBlack) {
      failures.push('Canvas center pixel is black — scene likely did not render.');
    }
    if (movedDist < 0.5) {
      failures.push(`Player barely moved (${movedDist.toFixed(2)}m) holding KeyW — input/controller pipeline likely broken.`);
    }
    if (renderInfo.triangles <= 0) {
      failures.push('renderer.info.render.triangles is 0 — nothing real was drawn.');
    }
    if (renderInfo.calls <= 0 || renderInfo.calls > 2000) {
      failures.push(`renderer.info.render.calls (${renderInfo.calls}) is outside the sane 1-2000 band.`);
    }

    if (failures.length > 0) {
      throw new Error(failures.join(' | '));
    }

    console.log('[verify] PASS');
  } finally {
    server.kill();
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', cwd: ROOT });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

const OVERALL_TIMEOUT_MS = 150000; // +30s over the baseline for the F1 resilience probe's second page load
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error(`verify timed out after ${OVERALL_TIMEOUT_MS}ms`)), OVERALL_TIMEOUT_MS)
);

Promise.race([main(), timeout]).catch((err) => {
  console.error('[verify] FAIL:', err.message);
  cleanup();
  process.exit(1);
});
