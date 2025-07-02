/* ====================================================================
 * map.js – Google Photorealistic 3D-tiles ⇄ on-demand voxel / MC view
 * ===================================================================*/

import * as THREE                   from 'three';
import { OrbitControls }            from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGPURenderer }           from 'three/webgpu';

import { TilesRenderer }            from '3d-tiles-renderer';
import { TileCompressionPlugin,
         TilesFadePlugin,
         GLTFExtensionsPlugin       } from '3d-tiles-renderer/plugins';
import { DRACOLoader                } from 'three/examples/jsm/loaders/DRACOLoader.js';

import { voxelizeModel              } from './voxelize-model.js';
import { initBlockData,
         assignVoxelsToBlocks       } from './assignToBlocksForGLB.js';

import { GUI                        } from 'three/addons/libs/lil-gui.module.min.js';

/* ───────────────────────────────── HUD + mini-map ────────────────── */
class HUD {
  constructor() {
    this.key   = document.querySelector('#google-api-key');
    this.coords= document.querySelector('#lat-lng');
    this.sse   = document.querySelector('#sse');
    this.logEl = document.querySelector('#fetch-log');
    this.fetch = document.querySelector('#fetch');

    this.key.value    = localStorage.getItem('token')  ?? '';
    this.coords.value = localStorage.getItem('coords') ?? '37.7749,-122.4194';

    const mb =
      'pk.eyJ1Ijoib21hcnNoZWhhdGEiLCJhIjoiY2xweWh4eWE3MDRmdDJtcGYyYnlsNW1jNiJ9.P6DvtW98Fx82KTMNQCYqwA';
    this.map = L.map('map',{zoomControl:false})
                .setView(this.coords.value.split(',').map(Number),15);
    L.tileLayer(
      `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}?access_token=${mb}`,
      {maxZoom:19}
    ).addTo(this.map);

    this.map.on('moveend',()=>{
      const c=this.map.getCenter();
      this.coords.value=`${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;
      localStorage.setItem('coords',this.coords.value);
    });

    this.key.onchange  =()=>localStorage.setItem('token',this.key.value);
    this.fetch.onclick =()=>this.onFetch?.();
  }
  getKey()       {return this.key.value.trim();}
  getSSE()       {return +this.sse.value;}
  getLatLon()    {return this.coords.value.split(',').map(Number);}
  log(m)         {this.logEl.textContent+=m+'\n';}
}
const ui=new HUD();

/* ───────────────────────────────  Three.js set-up ─────────────────── */
let scene,camera,controls,renderer,tiles=null;

(async()=>{
  if('gpu' in navigator){
    renderer=new WebGPURenderer({antialias:true});       // WebGPU first
    await renderer.init();
  }else{
    renderer=new THREE.WebGLRenderer({antialias:true});
  }
  document.body.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x151c1f);
  scene.add(new THREE.HemisphereLight(0xffffff,0x202020,1));

  camera=new THREE.PerspectiveCamera(60,1,100,1_600_000);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true; controls.maxDistance=3e4;

  window.addEventListener('resize',resize); resize();

  buildGUI();
  requestAnimationFrame(loop);
})();

function resize(){
  const w=innerWidth,h=innerHeight;
  camera.aspect=w/h; camera.updateProjectionMatrix();
  renderer.setSize(w,h);
  renderer.setPixelRatio?.(devicePixelRatio);
}

/* ───────────────────────────── TilesRenderer factory ──────────────── */
function spawnTiles(root,key,latDeg,lonDeg){
  if(tiles){scene.remove(tiles.group);tiles.dispose();}
  tiles=new TilesRenderer(root);
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new TilesFadePlugin());
  tiles.registerPlugin(new GLTFExtensionsPlugin({
    dracoLoader:new DRACOLoader()
      .setDecoderPath('https://unpkg.com/three@0.160/examples/jsm/libs/draco/gltf/')
  }));

  /* keep single session id and key everywhere */
  let sessionId;
  tiles.preprocessURL = u=>{
    if(u.startsWith('blob:')||u.startsWith('data:')) return u;
    const url=new URL(u,'https://tile.googleapis.com');
    if(url.searchParams.has('session')) sessionId=url.searchParams.get('session');
    if(sessionId && !url.searchParams.has('session')) url.searchParams.set('session',sessionId);
    if(!url.searchParams.has('key'))     url.searchParams.set('key',key);
    return url.toString();
  };

  tiles.setLatLonToYUp(latDeg*THREE.MathUtils.DEG2RAD,
                       lonDeg*THREE.MathUtils.DEG2RAD);
  tiles.errorTarget=ui.getSSE();
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera,renderer);

  let framed=false;
  tiles.addEventListener('load-tile-set', ()=>{
    if(framed) return;
    const s=new THREE.Sphere();
    if(tiles.getBoundingSphere(s)){
      controls.target.copy(s.center);
      camera.position.copy(s.center).add(new THREE.Vector3(0,0,s.radius*2.5));
      controls.update(); 
      framed=true;
    }
  });

  // Event Handlers
  tiles.addEventListener('load-model', onTileLoad);
  tiles.addEventListener('dispose-model', onTileDispose);

  // This is the key handler for managing LOD changes. When the renderer
  // determines a tile is no longer visible (e.g., because it's been
  // refined into higher-resolution children), we clean up its voxel mesh.
  // When it becomes visible, we can trigger voxelization.
  tiles.addEventListener('tile-visibility-change', ({ tile, visible }) => {
    // 'tile' is the renderer's internal tile object.
    // The actual three.js mesh group is in 'tile.cached.scene'.
    const tileGroup = tile.cached.scene;
    if (!tileGroup) return; // Group not loaded yet.

    if (visible) {
      // If voxel mode is on and this tile becomes visible, build its voxel mesh.
      if(state.vox && !tileGroup._voxMesh && !voxelizingTiles.has(tileGroup)) {
        buildVoxelFor(tileGroup);
      }
    } else {
      // If the tile becomes invisible, it's likely replaced by children (higher LOD)
      // or the camera moved away. We must clean up our custom voxel meshes.
      cleanupTileVoxels(tileGroup);
    }
    // After any change, re-evaluate what should be visible (original vs. voxel).
    applyVis(tileGroup);
  });
  
  scene.add(tiles.group);
}

/* ─────────────────────────────────── GUI & state ──────────────────── */
const state={resolution:64, vox:false, mc:false};
let lastVoxelUpdateTime = 0;

function buildGUI(){
  const g=new GUI({width:260});
  g.add(state,'resolution',4,1024,1).name('Voxel Res').onFinishChange(rebuildAll);
  g.add(state,'vox').name('Show Voxels').onChange(() => {
    // When toggling voxel mode, update everything.
    // updateVis will handle creating/hiding voxels as needed.
    updateVis();
  });
  g.add(state,'mc').name('Minecraft Textures').onChange(async (value) => {
    if(value && state.vox && tiles && tiles.group) {
      const tilesToConvert = [];
      if(tiles.group.children) {
        tiles.group.children.forEach(tile => {
          if(tile && tile.type === 'Group' && tile._voxMesh && !tile._mcMesh) {
            tilesToConvert.push(tile);
          }
        });
      }
      for(const tile of tilesToConvert) {
        await buildMinecraftFor(tile);
      }
    }
    updateVis();
  });
}

/* ───────────────────── helper to dispose THREE objects ───────────── */
function dispose(o){
  if(!o) return;
  if(o.userData && o.userData.sourceTile) {
    const tile = o.userData.sourceTile;
    if(tile._voxMesh === o) delete tile._voxMesh;
    if(tile._mcMesh === o) delete tile._mcMesh;
    delete o.userData.sourceTile;
  }
  
  if(o.traverse && typeof o.traverse === 'function') {
    o.traverse(n=>{
      if(n.isMesh){
        n.geometry?.dispose();
        (Array.isArray(n.material)?n.material:[n.material])
          .forEach(m=>{
            if(m) {
              m.map?.dispose();
              m.dispose();
            }
          });
      }
    });
  } else if(o.isMesh) {
    o.geometry?.dispose();
    (Array.isArray(o.material)?o.material:[o.material])
      .forEach(m=>{
        if(m) {
          m.map?.dispose();
          m.dispose();
        }
      });
  }
  o.parent?.remove(o);
}

/* ───────────────────── per-tile voxel / MC logic ──────────────────── */

const voxelizingTiles = new Set();
const disposingTiles = new Set();

async function buildVoxelFor(tile){
  if(!tile || tile._voxMesh || voxelizingTiles.has(tile) || disposingTiles.has(tile) || !tile.visible) return;
  if(!tile.parent || tile.parent !== tiles.group) return;
  
  let hasMeshes = false;
  tile.traverse(n => { if(n.isMesh && n.geometry) hasMeshes = true; });
  if(!hasMeshes) return;
  
  voxelizingTiles.add(tile);
  try{
    tile.updateMatrixWorld(true);
    const tempContainer = new THREE.Group();
    tempContainer.applyMatrix4(tile.matrixWorld);
    const clone = tile.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    tempContainer.add(clone);
    
    const vox = await voxelizeModel({ model: tempContainer, renderer, scene, resolution: state.resolution });
    
    if(!tile.parent || tile.parent !== tiles.group || disposingTiles.has(tile)) {
      dispose(vox.voxelMesh);
      dispose(tempContainer);
      return;
    }

    const vMesh = vox.voxelMesh;
    vMesh.matrixAutoUpdate = false;
    vMesh.userData.sourceTile = tile;
    scene.add(vMesh);

    tile._voxMesh = vMesh;
    tile._voxelizer = vox;
    tile._tempContainer = tempContainer;

    if(state.mc) await buildMinecraftFor(tile);
    applyVis(tile);
  }catch(e){ 
    console.warn('voxelise failed',e);
  } finally {
    voxelizingTiles.delete(tile);
  }
}

async function buildMinecraftFor(tile){
  if(!tile || tile._mcMesh || !tile._voxelizer || !tile._tempContainer || disposingTiles.has(tile)) return;
  if(!tile.parent || tile.parent !== tiles.group) return;
  
  try {
    await initBlockData();
    const container = tile._tempContainer;
    container._voxelGrid = tile._voxelizer._voxelGrid;
    if(!container.editor) container.editor = {update(){}};
    await assignVoxelsToBlocks(container);

    if(!tile.parent || tile.parent !== tiles.group || disposingTiles.has(tile)) {
      const mc = container.getObjectByName('voxelGroup');
      if(mc) dispose(mc);
      return;
    }

    const mc = container.getObjectByName('voxelGroup');
    if(mc){
      mc.matrixAutoUpdate = false;
      scene.add(mc);
      tile._mcMesh = mc;
      mc.userData.sourceTile = tile;
    }
    applyVis(tile);
  } catch(e) {
    console.warn('Minecraft conversion failed', e);
  }
}

// The 'scene' from the event is the THREE.Group for the tile.
function onTileLoad({scene:tile}){
  if(!tile || !tile.parent || tile.parent !== tiles.group || tile.type !== 'Group') return;
  tile.updateMatrixWorld(true);

  // The complex 'cleanupOverlappingVoxels' is no longer needed.
  // The 'tile-visibility-change' event now handles removing voxels from
  // parent tiles when children (higher LODs) are loaded.
  applyVis(tile);
  
  // Automatically voxelize if vox mode is on.
  if(state.vox && tile.visible && !tile._voxMesh && !voxelizingTiles.has(tile)) {
    requestAnimationFrame(() => {
      if(tile.parent && tile.visible && !tile._voxMesh && !voxelizingTiles.has(tile) && !disposingTiles.has(tile)) {
        buildVoxelFor(tile);
      }
    });
  }
}

// The 'scene' from the event is the THREE.Group for the tile.
function onTileDispose({scene:tile}){
  if(tile) {
    disposingTiles.add(tile);
    cleanupTileVoxels(tile);
    disposingTiles.delete(tile);
  }
}

function cleanupTileVoxels(tile){
  if(!tile) return;
  
  disposingTiles.add(tile);
  try {
    dispose(tile._voxMesh); 
    dispose(tile._mcMesh);
    dispose(tile._tempContainer);
    
    voxelizingTiles.delete(tile);
    
    delete tile._voxMesh;
    delete tile._mcMesh;
    delete tile._voxelizer;
    delete tile._tempContainer;
  } finally {
    disposingTiles.delete(tile);
  }
}

/* ─────────────────────── visibility resolver ─────────────────────── */
function applyVis(tile){
  if(!tile || !tile.parent || tile.parent !== tiles.group || typeof tile.type !== 'string' || tile.visible === undefined) return;
  
  const showV = state.vox && !state.mc;
  const showM = state.vox &&  state.mc;
  const hasVoxelVersion = tile._voxMesh || tile._mcMesh;
  
  // The visibility of the tile itself is controlled by the renderer for LOD.
  // When in voxel mode, we hide the original tile IF a voxel version exists,
  // letting the voxel mesh be visible instead.
  tile.visible = state.vox ? !hasVoxelVersion : true;

  if(tile._voxMesh) tile._voxMesh.visible = showV;
  if(tile._mcMesh) tile._mcMesh.visible = showM;
}

function updateVis(){
  if(!tiles || !tiles.group) return;
  
  if (tiles.group.children) {
    tiles.group.children.forEach(tile => {
      if (tile && tile.type === 'Group') {
        // If we're turning voxel mode on, and a tile is visible but
        // not voxelized yet, build it.
        if (state.vox && tile.visible && !tile._voxMesh && !voxelizingTiles.has(tile)) {
          buildVoxelFor(tile);
        }
        // Apply the latest visibility rules to the tile and its voxel meshes.
        applyVis(tile);
      }
    });
  }
}

function rebuildAll(){
  if(!tiles || !tiles.group) return;
  
  if (tiles.group.children) {
    const tilesToClean = tiles.group.children.filter(child =>
      child && (child._voxMesh || child._mcMesh)
    );
    tilesToClean.forEach(cleanupTileVoxels);
  }
  
  voxelizingTiles.clear();
  disposingTiles.clear();
  
  updateVis();
}

/* ─────────────────────── HUD fetch callback ──────────────────────── */
ui.onFetch=()=>{
  const key=ui.getKey(); 
  if(!key){ui.log('🔑 API key required');return;}
  const [lat,lon]=ui.getLatLon();
  const root=`https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`;
  spawnTiles(root,key,lat,lon);
  ui.log(`🌍 streaming ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
};

/* ───────────────────────── render loop ───────────────────────────── */
const VOXEL_UPDATE_INTERVAL = 100;

function loop(){
  requestAnimationFrame(loop);
  controls.update();
  
  if(tiles){ 
    camera.updateMatrixWorld(); 
    tiles.update();
    
    // This periodic check is a good fallback to catch any visible tiles
    // that slipped through the event-based voxelization.
    const now = performance.now();
    if(state.vox && now - lastVoxelUpdateTime > VOXEL_UPDATE_INTERVAL) {
      lastVoxelUpdateTime = now;
      
      if(tiles.group && tiles.group.children) {
        const tilesToVoxelize = [];
        tiles.group.children.forEach(tile => {
          if (tile && tile.type === 'Group' && tile.visible && !tile._voxMesh && !voxelizingTiles.has(tile) && !disposingTiles.has(tile)) {
            tilesToVoxelize.push(tile);
          }
        });
        
        if (tilesToVoxelize.length > 0) {
          const camPos = camera.position;
          tilesToVoxelize.sort((a, b) => {
            const aPos = new THREE.Vector3();
            const bPos = new THREE.Vector3();
            a.getWorldPosition(aPos);
            b.getWorldPosition(bPos);
            return aPos.distanceToSquared(camPos) - bPos.distanceToSquared(camPos);
          });
          
          tilesToVoxelize.slice(0, 3).forEach(tile => buildVoxelFor(tile));
        }
      }
    }
  }
  
  renderer.render(scene,camera);
}