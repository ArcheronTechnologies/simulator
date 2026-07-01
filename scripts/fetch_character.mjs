#!/usr/bin/env node
// Downloads the CC0 Quaternius "Universal Animation Library" character
// (rigged humanoid + idle/walk/run/etc. clips) into public/assets/.
// Source: https://github.com/J-Ponzo/gltf-universal-animation-library
// (CC0 1.0 mirror of https://quaternius.itch.io/universal-animation-library)
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets');

const BASE_URL =
  'https://raw.githubusercontent.com/J-Ponzo/gltf-universal-animation-library/main/glTF';
const FILES = ['AnimationLibrary_Godot_Standard.gltf', 'AnimationLibrary_Godot_Standard.bin'];

async function downloadFile(name) {
  const dest = path.join(OUT_DIR, name);
  if (existsSync(dest)) {
    console.log(`[fetch_character] ${name} already present, skipping`);
    return;
  }

  console.log(`[fetch_character] downloading ${name}...`);
  const res = await fetch(`${BASE_URL}/${name}`, {
    headers: { 'User-Agent': 'lund-walkable-simulation/0.1 (research/hobby project)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${name}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buffer);
  console.log(`[fetch_character] wrote ${name} (${(buffer.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const name of FILES) {
    await downloadFile(name);
  }
  console.log('[fetch_character] done');
}

main().catch((err) => {
  console.error('[fetch_character] FAILED:', err);
  process.exit(1);
});
