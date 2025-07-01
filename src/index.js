/* index.js – viewer / voxeliser / Minecraft-toggle coordinator */

import { Viewer }                       from './Viewer.js';
import { UI }                           from './UI.js';
import { voxelizeModel }                from './voxelize-model.js';
import { GUI }                          from 'three/addons/libs/lil-gui.module.min.js';
import { load }                         from '@loaders.gl/core';
import { Tileset3D }                    from '@loaders.gl/tiles';
import { Tiles3DLoader }                from '@loaders.gl/3d-tiles';
import { WebMercatorViewport }          from '@deck.gl/core';
import { initBlockData,
         assignVoxelsToBlocks }         from './assignToBlocksForGLB.js';
import * as THREE                       from 'three';

/* ------------------------------------------------------------------ */
/* UI set-up                                                          */
/* ------------------------------------------------------------------ */
const ui  = new UI();
const gui = new GUI({ width: 260 });

const voxCtrl = {
  resolution : 64,
  visible    : true,
  minecraft  : false
};

const voxFolder = gui.addFolder('Voxels');
voxFolder
  .add(voxCtrl, 'resolution', 4, 2000, 1)
  .name('Voxel Resolution')
  .onChange(buildVoxels);

voxFolder
  .add(voxCtrl, 'visible')
  .name('Show Voxels')
  .onChange(flag => {
    if (viewer.colorMesh   ) viewer.colorMesh.visible   = flag && !voxCtrl.minecraft;
    if (viewer.mcGroup     ) viewer.mcGroup.visible     = flag &&  voxCtrl.minecraft;
    if (viewer.tilesContainer) viewer.tilesContainer.visible = !flag;
  });

voxFolder
  .add(voxCtrl, 'minecraft')
  .name('Minecraft Textures')
  .onChange(handleMinecraftToggle);

voxFolder.open();

/* ------------------------------------------------------------------ */
/* viewer                                                             */
/* ------------------------------------------------------------------ */
const viewer = new Viewer({
  onTilesReady: async () => buildVoxels(voxCtrl.resolution)
});

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
function disposeMesh(obj) {
  if (!obj) return;
  obj.traverse(o => {
    if (o.isMesh) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    }
  });
  if (obj.parent) obj.parent.remove(obj);
}

/* ------------------------------------------------------------------ */
/* build greedy coloured voxel mesh                                   */
/* ------------------------------------------------------------------ */
let voxelising = false;

async function buildVoxels (res) {
  if (voxelising || !viewer.tilesContainer) return;
  voxelising = true;

  ui.log(`Voxelising at resolution ${res} …`);

  /* clean previous meshes ----------------------------------------- */
  disposeMesh(viewer.colorMesh);
  disposeMesh(viewer.mcGroup);
  viewer.colorMesh = viewer.mcGroup = null;

  try {
    const t0  = performance.now();
    const vox = await voxelizeModel({
      model      : viewer.tilesContainer,
      renderer   : viewer.renderer,
      resolution : res,
      scene      : viewer.scene
    });

    /* store references */
    viewer.voxelizer  = vox;
    viewer.colorMesh  = vox.voxelMesh;
    viewer.colorMesh.visible = voxCtrl.visible && !voxCtrl.minecraft;
    viewer.scene.add(viewer.colorMesh);
    viewer.tilesContainer.visible = !voxCtrl.visible;

    ui.log(`✅ Voxelised (${vox.voxelCount.toLocaleString()} voxels) in ${(performance.now()-t0).toFixed(1)} ms`);

    /* if MC toggle already on – regenerate block mesh ------------- */
    if (voxCtrl.minecraft) await handleMinecraftToggle(true, /*clearOnly=*/false);

  } catch (e) {
    console.error(e);
    ui.log(`⚠️ ${e}`);
  } finally {
    voxelising = false;
  }
}

/* ------------------------------------------------------------------ */
/* MC toggle                                                          */
/* ------------------------------------------------------------------ */
async function handleMinecraftToggle (enabled, clearOnly = false) {
  if (!viewer.voxelizer) {
    ui.log('Voxelise first!');
    voxCtrl.minecraft = false;
    voxFolder.updateDisplay();
    return;
  }

  /* always remove any existing MC group first --------------------- */
  disposeMesh(viewer.mcGroup);
  viewer.mcGroup = null;
  if (!enabled || clearOnly) {
    /* just revert to coloured mesh */
    if (viewer.colorMesh) viewer.colorMesh.visible = voxCtrl.visible;
    return;
  }

  ui.log('⛏️ Converting to Minecraft textures …');

  await initBlockData();

  /* give assignVoxelsToBlocks an object that looks like a “GLB display”
     but still points at our THREE.Scene so add()/remove() work            */
  const sceneWrapper = viewer.scene;
  sceneWrapper._voxelGrid = viewer.voxelizer._voxelGrid;
  /* the helper sometimes calls .editor.update(); provide a stub         */
  if (!sceneWrapper.editor) sceneWrapper.editor = { update (){} };

  await assignVoxelsToBlocks(sceneWrapper);

  /* grab the freshly created group */
  viewer.mcGroup = sceneWrapper.getObjectByName('voxelGroup');
  if (!viewer.mcGroup) {
    ui.log('⚠️ Minecraft conversion failed');
    voxCtrl.minecraft = false;
    voxFolder.updateDisplay();
    return;
  }

  /* final visibility setup */
  viewer.mcGroup.visible   = voxCtrl.visible;
  if (viewer.colorMesh) viewer.colorMesh.visible = false;

  ui.log('✅ Minecraft conversion done');
}

/* ------------------------------------------------------------------ */
/* GOOGLE 3-D-TILES fetcher (unchanged)                               */
/* ------------------------------------------------------------------ */
async function fetch3DTiles () {
  ui.setDebugSliderVisibility(false);
  const { lat,lng,zoom } = ui.getLatLngZoom();
  const GOOGLE_API_KEY   = ui.getGoogleAPIKey();

  const tilesetUrl = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_API_KEY}`;
  const targetSSE  = ui.getScreenSpaceError();

  ui.log(`Fetching tiles at (${lat},${lng},z${zoom},sse ${targetSSE})`);

  const viewport = new WebMercatorViewport({ width:230,height:175, latitude:lat, longitude:lng, zoom });
  const json     = await load(tilesetUrl, Tiles3DLoader, { '3d-tiles': { loadGLTF:false }});
  const tiles3d  = new Tileset3D(json, { maximumScreenSpaceError: targetSSE, throttleRequests:false });
  while (!tiles3d.isLoaded()) await tiles3d.selectTiles(viewport);

  const session = new URL(`https://x?${tiles3d.queryParams}`).searchParams.get('session');
  const tiles   = [...tiles3d.tiles].sort((a,b)=>a.header.geometricError-b.header.geometricError);
  const urls    = [];

  for (const t of tiles) {
    if (Math.abs(targetSSE - t.header.geometricError) <= targetSSE) {
      urls.push(`${t.contentUrl}?key=${GOOGLE_API_KEY}&session=${session}`);
      if (urls.length>=100) break;
    }
  }
  if (!urls.length) {
    ui.log('No tiles matched SSE – fetching a few anyway …');
    tiles.slice(0,50).forEach(t=>urls.push(`${t.contentUrl}?key=${GOOGLE_API_KEY}&session=${session}`));
  }

  viewer.loadGLTFTiles(urls, ui.log);
  ui.setDebugSliderVisibility(true);
  ui.updateDebugSliderRange(urls.length);
}

/* ------------------------------------------------------------------ */
/* UI callbacks                                                      */
/* ------------------------------------------------------------------ */
ui.onFetch           = fetch3DTiles;
ui.onDownload        = () => viewer.generateCombineGltf();
ui.onTileSliderChange= v => viewer.gltfArray.forEach((gltf,i)=>gltf.scene.visible = i<=v);
