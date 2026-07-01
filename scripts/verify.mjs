// Headless smoke test: builds the app, serves it, and confirms it renders
// without errors. Extended in later steps to assert player movement.
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

    const jsErrors = await page.evaluate(() => window.__ERRORS__ || []);
    const allErrors = [...pageErrors, ...jsErrors];

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

    if (allErrors.length > 0) {
      throw new Error(`Page reported ${allErrors.length} error(s): ${allErrors.join(' | ')}`);
    }
    if (!isNonBlack) {
      throw new Error('Canvas center pixel is black — scene likely did not render.');
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

const OVERALL_TIMEOUT_MS = 90000;
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error(`verify timed out after ${OVERALL_TIMEOUT_MS}ms`)), OVERALL_TIMEOUT_MS)
);

Promise.race([main(), timeout]).catch((err) => {
  console.error('[verify] FAIL:', err.message);
  cleanup();
  process.exit(1);
});
