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

Open the printed local URL. WASD/mouse to move once the character controller
lands (see project status below).

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

## Architecture

- **Rendering**: Three.js (WebGL), streamed tile-by-tile around the player.
- **World data**: real OpenStreetMap building footprints, roads, water, and
  land use for Lund, projected into a local meter-based coordinate system
  and pre-processed into compact per-tile JSON files (see `scripts/`).
- **Collision**: `three-mesh-bvh` capsule-vs-mesh collision against the
  streamed building geometry.

See `src/` for the application and `scripts/` for the OSM data pipeline.
