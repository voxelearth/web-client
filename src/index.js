import { Viewer }          from './Viewer.js';
import { UI }              from './UI.js';
import { voxelizeModel }   from './voxelize-model.js';
import { GUI }             from 'three/addons/libs/lil-gui.module.min.js';

import { load }            from '@loaders.gl/core';
import { Tileset3D }       from '@loaders.gl/tiles';
import { Tiles3DLoader }   from '@loaders.gl/3d-tiles';
import { WebMercatorViewport } from '@deck.gl/core';

/* ------------------------------------------------------------- */
/* global UI + lil-gui                                           */
/* ------------------------------------------------------------- */

const ui  = new UI();
const gui = new GUI({ width: 260 });

/* voxel GUI state */
const voxCtrl = {
  resolution: 64,   // default; user can change
  visible:    true
};

/* build the “Voxels” folder */
const voxFolder = gui.addFolder('Voxels');
voxFolder
  .add(voxCtrl, 'resolution', 4, 2000, 1)
  .name('Voxel Resolution')
  .onChange(async (val) => {
    await buildVoxels(val);
  });

voxFolder
  .add(voxCtrl, 'visible')
  .name('Show Voxels')
  .onChange((flag) => {
    if (viewer.voxelMesh)       viewer.voxelMesh.visible      = flag;
    if (viewer.tilesContainer)  viewer.tilesContainer.visible = !flag;
  });
voxFolder.open();

/* ------------------------------------------------------------- */
/* create viewer                                                 */
/* ------------------------------------------------------------- */

const viewer = new Viewer({
  /* fired once the Google-3D-Tiles container is ready */
  onTilesReady: async ({ tilesContainer }) => {
    await buildVoxels(voxCtrl.resolution); // first build with slider’s value
  }
});

/* helper to (re)build voxels at given resolution */
let voxelising = false;
async function buildVoxels(res) {
  if (voxelising || !viewer.tilesContainer) return;
  voxelising = true;
  ui.log(`Voxelising at resolution ${res} …`);

  /* remove previous voxel mesh */
  if (viewer.voxelMesh) {
    viewer.scene.remove(viewer.voxelMesh);
    viewer.voxelMesh.geometry.dispose();
    viewer.voxelMesh.material.dispose();
    viewer.voxelMesh = null;
  }

  try {
    const start = performance.now();
    const vox = await voxelizeModel({
      model:     viewer.tilesContainer,
      renderer:  viewer.renderer,
      resolution: res,
      scene:     viewer.scene
    });

    viewer.voxelMesh             = vox.voxelMesh;
    viewer.voxelMesh.visible     = voxCtrl.visible;
    viewer.tilesContainer.visible = !voxCtrl.visible;

    const elapsed = performance.now() - start;
    ui.log(`✅ Voxelisation done in ${elapsed.toFixed(2)} ms`);
    ui.log(`✅ voxels: ${vox.voxelCount.toLocaleString()}`);
  } catch (e) {
    console.error(e);
    ui.log(`⚠️ Voxelisation error: ${e}`);
  } finally {
    voxelising = false;
  }
}

/* ------------------------------------------------------------- */
/* UI callbacks already present                                  */
/* ------------------------------------------------------------- */

ui.onFetch = async () => {
  ui.clearLog();
  ui.log('Fetching …');
  ui.fetchTilesBtn.disabled = true;

  try {
    await fetch3DTiles();
  } catch (e) {
    console.error(e);
    ui.log(`Failed to fetch 3-D Tiles! Error: ${e}`);
  }
  ui.fetchTilesBtn.disabled = false;
};

ui.onDownload = () => {
  viewer.generateCombineGltf();
};

ui.onTileSliderChange = (v) => {
  viewer.gltfArray.forEach((gltf, i) => (gltf.scene.visible = i <= v));
};

/* ------------------------------------------------------------- */
/* 3-D-Tiles fetcher                                             */
/* ------------------------------------------------------------- */

async function fetch3DTiles() {
  ui.setDebugSliderVisibility(false);

  const { lat, lng, zoom } = ui.getLatLngZoom();
  const GOOGLE_API_KEY = ui.getGoogleAPIKey();
  const tilesetUrl =
    `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_API_KEY}`;
  const targetSSE = ui.getScreenSpaceError();

  ui.log(`Fetching tiles at (${lat}, ${lng}, z${zoom}, sse ${targetSSE})`);

  const viewport = new WebMercatorViewport({
    width : 230,
    height: 175,
    latitude : lat,
    longitude: lng,
    zoom
  });

  const tileset = await load3DTileset(tilesetUrl, viewport, targetSSE);
  const sessionKey = getSessionKey(tileset);

  const tiles = [...tileset.tiles].sort(
    (a, b) => a.header.geometricError - b.header.geometricError
  );

  const urls = [];
  for (const t of tiles) {
    if (Math.abs(targetSSE - t.header.geometricError) <= targetSSE) {
      urls.push(`${t.contentUrl}?key=${GOOGLE_API_KEY}&session=${sessionKey}`);
      if (urls.length >= 100) break;
    }
  }

  if (!urls.length) {
    ui.log('No tiles matched SSE – fetching a few anyway …');
    tiles.slice(0, 50).forEach(t =>
      urls.push(`${t.contentUrl}?key=${GOOGLE_API_KEY}&session=${sessionKey}`)
    );
  }

  viewer.loadGLTFTiles(urls, ui.log);
  ui.setDebugSliderVisibility(true);
  ui.updateDebugSliderRange(urls.length);
}

/* util helpers ------------------------------------------------ */

async function load3DTileset(url, viewport, sse) {
  const json   = await load(url, Tiles3DLoader, { '3d-tiles': { loadGLTF:false } });
  const tiles3d = new Tileset3D(json, { maximumScreenSpaceError: sse, throttleRequests: false });

  while (!tiles3d.isLoaded()) await tiles3d.selectTiles(viewport);
  return tiles3d;
}
function getSessionKey(tileset) {
  return new URL(`https://x?${tileset.queryParams}`).searchParams.get('session');
}
