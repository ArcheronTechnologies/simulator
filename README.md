# Lund Walkable Simulation

A walkable, 1:1 digital reconstruction of Lund, Sweden, built from real
OpenStreetMap data. This is the foundation for a game: the first milestone is
a proof of concept — a third-person character walking a streaming,
full-fidelity recreation of the city — with gameplay layered on top later.

## Requirements

- Node.js 22.12+
- npm

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL. You spawn at Lund Cathedral on the committed
central-core tileset, which works immediately with no data fetch required.

**Controls**: `WASD` move &middot; `Shift` run &middot; `Space` jump &middot;
click the canvas to lock the mouse and look around.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run data:core` | Fetch/refresh OSM data for the central Lund core |
| `npm run data:all` | Fetch/refresh OSM data for the whole municipality |
| `npm run fetch:character` | Download the CC0 character model |
| `npm run verify` | Headless build + render + movement smoke test (Playwright) |
| `npm test` | Run the unit test suite (`node --test`) |

### Regenerating map data

`public/tiles/` ships with a compact tileset (~2.4 km box around the
Cathedral, spawn point included) committed to the repo so the app runs out
of the box. `npm run data:all` fetches the whole municipality (~430 km²,
~240 Overpass cells, several thousand tiles, tens of MB) into that same
directory for local exploration — deliberately **not** committed
(`.gitignore` blocks new tile JSON there, though the already-committed core
files stay tracked). Overpass mirrors are occasionally flaky; the fetcher
retries and rotates across three mirrors automatically and caches raw
per-cell responses in `data/cache/` (also git-ignored) so a re-run resumes
instead of re-fetching everything.

Running `npm run data:all` will leave `public/tiles/manifest.json` and the
handful of core tile files modified in `git status` (since the full run
overwrites them with municipality-wide data in the same directory). Run
`git checkout -- public/tiles/` to drop those local changes and return to
the committed core tileset.

## Architecture

- **Rendering**: Three.js (WebGL), streamed tile-by-tile around the player.
- **World data**: real OpenStreetMap building footprints, roads, water, and
  land use for Lund, projected into a local meter-based coordinate system
  and pre-processed into compact per-tile JSON files (see `scripts/`).
- **Collision**: `three-mesh-bvh` capsule-vs-mesh collision against the
  streamed building geometry.

See `src/` for the application and `scripts/` for the OSM data pipeline.
