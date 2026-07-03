# Lund Walkable Simulation

A walkable, 1:1 digital reconstruction of Lund, Sweden, built from real
OpenStreetMap data. This is the foundation for a game: a third-person character
walks a streaming, full-fidelity recreation of the city, now populated by its
citizens — unique people with homes, jobs, and 24-hour schedules, so the
streets fill and empty with the rhythm of a real day under a moving sun.

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
click the canvas to lock the mouse and look around &middot; `[` / `]` change the
time-of-day speed &middot; `P` pause time.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run data:core` | Fetch/refresh OSM data for the central Lund core |
| `npm run data:all` | Fetch/refresh OSM data for the whole municipality |
| `npm run data:population` | Generate the core citizen population from cached OSM data |
| `npm run data:population:all` | Generate the full ~120k-citizen municipality population |
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

### Citizen population

`public/population/` holds the simulated **citizens of Lund** — each with a
home, a workplace/school, and a 24-hour schedule, generated deterministically
from the same cached OSM data (`scripts/generate_population.mjs`, no re-fetch).
Buildings are classified into homes vs workplaces from their OSM tags and
containing landuse; citizens are assigned homes to capacity and matched to
nearby jobs by archetype. Only citizens near the player are rendered — the rest
are simulated abstractly from their schedule.

The compact **core** population (central Lund, committed) works out of the box.
`npm run data:population:all` regenerates the full ~120k set into the same
directory (git-ignored); `git checkout -- public/population/` restores the
committed core. Regeneration reads `data/cache/overpass/` (populate it first
with `npm run data:all`).

## Architecture

- **Rendering**: Three.js (WebGL), streamed tile-by-tile around the player.
- **World data**: real OpenStreetMap building footprints, roads, water, and
  land use for Lund, projected into a local meter-based coordinate system
  and pre-processed into compact per-tile JSON files (see `scripts/`).
- **Collision**: `three-mesh-bvh` capsule-vs-mesh collision against the
  streamed building geometry.
- **Citizens** (`src/sim/`): a three-tier agent LOD — the whole ~120k
  population is dormant, citizens homed in loaded tiles are tracked from their
  pure 24-hour schedule, and only the nearest ~150 outdoors get pooled,
  animated bodies that walk the real street network. A game clock drives both
  the schedules and a dynamic day/night sky.

See `src/` for the application and `scripts/` for the OSM data pipeline.
