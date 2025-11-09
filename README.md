# Voxel Earth — Web Client
**VoxelEarth monorepo with consistent versions:** https://github.com/ryanhlewis/VoxelEarth

A lightweight web client that fetches Google Photorealistic **3D Tiles**, normalizes/rotates them, and can hand them off to the Voxel Earth voxelization pipeline for experiments and demos.

> Based on (and thanks to) **Omar Shehata’s** work in **google-earth-as-gltf**, which demonstrates fetching 3D Tiles and normalizing them into viewable glTF.

## Run locally
```bash
npm install
npm run dev        # starts the dev server
# optional production build
npm run build
npm run preview
```

## Useful files & dirs
- `src/index.js` — fetch tiles (via loaders.gl), set up traversal.
- `src/Viewer.js` — normalize tiles from ECEF to an origin-centered frame for viewing.
- `simple-node-example/` — minimal example fetching tiles for a region.
- `public/` — static assets.

## Where this fits
Use this to visually explore tiles/regions and parameters (zoom, SSE) before running a full voxelization flow in the monorepo.

## Acknowledgements
- **Omar Shehata** — google-earth-as-gltf (viewer + examples).
- **Cesium / loaders.gl** — 3D Tiles traversal & decoding ecosystem.
- **Google** — Photorealistic 3D Tiles.
- **NASA AMMOS** — [3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS), a Three.js-based **3D Tiles** renderer used across planetary operations.
