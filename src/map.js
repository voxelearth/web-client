/* ====================================================================
 *  map.js – Google Photorealistic 3D-tiles ⇄ on-demand voxel / MC view
 * ===================================================================*/

import * as THREE                       from 'three';
import { OrbitControls }                from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGPURenderer }               from 'three/webgpu';

import { TilesRenderer }                from '3d-tiles-renderer';
import { TileCompressionPlugin,
         TilesFadePlugin,
         GLTFExtensionsPlugin          } from '3d-tiles-renderer/plugins';
import { DRACOLoader                   } from 'three/examples/jsm/loaders/DRACOLoader.js';

import { voxelizeModel                 } from './voxelize-model.js';
import { initBlockData,
         assignVoxelsToBlocks          } from './assignToBlocksForGLB.js';

import { GUI                           } from 'three/addons/libs/lil-gui.module.min.js';

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
      'REMOVED';
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
  getKey()        {return this.key.value.trim();}
  getSSE()        {return +this.sse.value;}
  getLatLon()     {return this.coords.value.split(',').map(Number);}
  log(m)          {this.logEl.textContent+=m+'\n';}
}
const ui=new HUD();

/* ───────────────────────────────  Three.js set-up ─────────────────── */
let scene,camera,controls,renderer,tiles=null;

(async()=>{
  if('gpu' in navigator){
    renderer=new WebGPURenderer({antialias:true});      // WebGPU first
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
    if(!url.searchParams.has('key'))    url.searchParams.set('key',key);
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
    
    // If vox mode is on, prepare for immediate voxelization
    if(state.vox) {
      lastVoxelUpdateTime = 0;
    }
  });

  tiles.addEventListener('load-model',   onTileLoad);
  tiles.addEventListener('dispose-model',onTileDispose);
  
  // Listen for various tile events to ensure voxelization happens
  tiles.addEventListener('load-content', () => {
    if(state.vox) {
      // Defer to next frame to ensure tiles are ready
      requestAnimationFrame(() => updateVis());
    }
  });
  
  // Also listen for tile visibility changes
  tiles.addEventListener('tile-visibility-change', ({tile, visible}) => {
    if(state.vox && visible && tile && !tile._voxMesh && !voxelizingTiles.has(tile)) {
      buildVoxelFor(tile);
    }
  });
  
  // Listen for when tile loading completes
  tiles.addEventListener('tiles-load-end', () => {
    if(state.vox) {
      // Process any remaining tiles that need voxelization
      updateVis();
    }
  });

  scene.add(tiles.group);
}

/* ─────────────────────────────────── GUI & state ──────────────────── */
const state={resolution:64, vox:false, mc:false};
let lastVoxelUpdateTime = 0; // Track when we last checked for voxelization

function buildGUI(){
  const g=new GUI({width:260});
  g.add(state,'resolution',4,1024,1).name('Voxel Res').onFinishChange(rebuildAll);
  g.add(state,'vox').name('Show Voxels').onChange((value) => {
    // Immediately update visibility
    updateVis();
    
    if(value && tiles && tiles.group) {
      // Reset the update timer to trigger immediate voxelization
      lastVoxelUpdateTime = 0;
      
      // Force immediate voxelization of visible tiles
      let voxelizeCount = 0;
      const tilesToVoxelize = [];
      
      if(tiles.group.children) {
        tiles.group.children.forEach(tile => {
          if(tile && tile.type === 'Group' && tile.visible && 
             !tile._voxMesh && !voxelizingTiles.has(tile)) {
            tilesToVoxelize.push(tile);
            voxelizeCount++;
          }
        });
      }
      
      // Voxelize collected tiles
      tilesToVoxelize.forEach(tile => buildVoxelFor(tile));
      
      if(voxelizeCount > 0) {
        ui.log(`Voxelizing ${voxelizeCount} tiles...`);
      }
    }
  });
  g.add(state,'mc').name('Minecraft Textures').onChange(async (value) => {
    if(value && state.vox && tiles && tiles.group) {
      // Convert existing voxels to Minecraft
      const tilesToConvert = [];
      
      if(tiles.group.children) {
        tiles.group.children.forEach(tile => {
          if(tile && tile._voxMesh && !tile._mcMesh) {
            tilesToConvert.push(tile);
          }
        });
      }
      
      // Convert all at once
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
  
  // If it's a voxel or MC mesh, remove its tile reference
  if(o.userData && o.userData.sourceTile) {
    const tile = o.userData.sourceTile;
    if(tile._voxMesh === o) delete tile._voxMesh;
    if(tile._mcMesh === o) delete tile._mcMesh;
    delete o.userData.sourceTile;
  }
  
  // Use traverse if available, otherwise try to dispose directly
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
    // Direct disposal for single mesh
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

/* Track voxelization status to prevent duplicate work */
const voxelizingTiles = new Set();
const disposingTiles = new Set();

/* 2. create voxel mesh maintaining proper world transforms */
async function buildVoxelFor(tile){
  // Check if already voxelizing, voxelized, or being disposed
  if(!tile || tile._voxMesh || voxelizingTiles.has(tile) || 
     disposingTiles.has(tile) || !tile.visible) return;
  
  // Verify tile is still in the scene
  if(!tile.parent || tile.parent !== tiles.group) return;
  
  // Check if tile has any meshes to voxelize
  let hasMeshes = false;
  if(tile.traverse && typeof tile.traverse === 'function') {
    tile.traverse(n => {
      if(n.isMesh && n.geometry) {
        hasMeshes = true;
      }
    });
  } else {
    // If traverse isn't available, skip this tile
    return;
  }
  
  if(!hasMeshes) return;
  
  voxelizingTiles.add(tile);
  
  try{
    // Ensure tile has updated world matrix
    tile.updateMatrixWorld(true);
    
    // Create a temporary container to hold the tile at its world position
    const tempContainer = new THREE.Group();
    tempContainer.applyMatrix4(tile.matrixWorld);
    
    // Clone the tile into the container
    const clone = tile.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    tempContainer.add(clone);
    
    // Voxelize the container (which includes world transform)
    const vox = await voxelizeModel({
      model: tempContainer,
      renderer,
      scene,
      resolution: state.resolution
    });
    
    // Check if tile still exists and not being disposed after async operation
    if(!tile.parent || tile.parent !== tiles.group || disposingTiles.has(tile)) {
      dispose(vox.voxelMesh);
      dispose(tempContainer);
      return;
    }

    const vMesh = vox.voxelMesh;
    vMesh.matrixAutoUpdate = false;
    
    // Store tile reference for cleanup
    vMesh.userData.sourceTile = tile;
    
    scene.add(vMesh);

    tile._voxMesh = vMesh;
    tile._voxelizer = vox;
    tile._tempContainer = tempContainer; // Keep reference for MC conversion

    if(state.mc) await buildMinecraftFor(tile);
    applyVis(tile);
    
    // Debug log
    console.log(`Voxelized tile at resolution ${state.resolution}, voxels: ${vox.voxelCount}`);
  }catch(e){ 
    console.warn('voxelise failed',e);
  } finally {
    voxelizingTiles.delete(tile);
  }
}

async function buildMinecraftFor(tile){
  if(!tile || tile._mcMesh || !tile._voxelizer || !tile._tempContainer || 
     disposingTiles.has(tile)) return;
  
  // Verify tile is still in the scene
  if(!tile.parent || tile.parent !== tiles.group) return;
  
  try {
    await initBlockData();
    
    // Use the temporary container that has the voxel data
    const container = tile._tempContainer;
    container._voxelGrid = tile._voxelizer._voxelGrid;
    if(!container.editor) container.editor = {update(){}};
    
    await assignVoxelsToBlocks(container);

    // Check if tile still exists and not being disposed after async operation
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
      
      // Store reference for cleanup
      mc.userData.sourceTile = tile;
    }
    applyVis(tile);
  } catch(e) {
    console.warn('Minecraft conversion failed', e);
  }
}

function onTileLoad({scene:tile}){
  // Skip if tile is invalid, not a direct child, or doesn't have proper structure
  if(!tile || !tile.parent || tile.parent !== tiles.group || tile.type !== 'Group') return;
  
  // Ensure the tile has its world matrix updated
  if(tile.updateMatrixWorld && typeof tile.updateMatrixWorld === 'function') {
    tile.updateMatrixWorld(true);
  }
  
  // Clean up any existing voxels for tiles at the same location
  // This handles tile replacement when higher resolution tiles load
  cleanupOverlappingVoxels(tile);
  
  applyVis(tile);
  
  // Automatically voxelize if vox mode is on - do it immediately, don't wait
  if(state.vox && tile.visible && !tile._voxMesh && !voxelizingTiles.has(tile)) {
    console.log('Tile loaded, queuing for voxelization');
    // Queue for next frame to ensure tile is fully loaded
    requestAnimationFrame(() => {
      if(tile.parent && tile.visible && !tile._voxMesh && !voxelizingTiles.has(tile) && !disposingTiles.has(tile)) {
        buildVoxelFor(tile);
      }
    });
  }
}

function onTileDispose({scene:tile}){
  // Mark tile as being disposed
  if(tile) {
    disposingTiles.add(tile);
    cleanupTileVoxels(tile);
    disposingTiles.delete(tile);
  }
}

function cleanupTileVoxels(tile){
  if(!tile) return;
  
  // Mark this tile as being cleaned up to prevent new voxelization
  disposingTiles.add(tile);
  
  try {
    dispose(tile._voxMesh); 
    dispose(tile._mcMesh);
    dispose(tile._tempContainer);
    
    // Remove from voxelizing set if present
    voxelizingTiles.delete(tile);
    
    delete tile._voxMesh;
    delete tile._mcMesh;
    delete tile._voxelizer;
    delete tile._tempContainer;
  } finally {
    // Always remove from disposing set
    disposingTiles.delete(tile);
  }
}

function cleanupOverlappingVoxels(newTile){
  // Don't check if tiles system isn't ready
  if(!tiles || !tiles.group || !newTile) return;
  
  // Verify newTile has proper methods
  if(!newTile.getWorldPosition || typeof newTile.getWorldPosition !== 'function') return;
  
  // For Google 3D tiles, we can use the tile's built-in bounds if available
  const tilesToClean = [];
  
  // Use children array instead of traverse to avoid errors
  if(tiles.group.children && Array.isArray(tiles.group.children)) {
    tiles.group.children.forEach(child => {
      // Skip if it's the new tile, or doesn't have voxels
      if(!child || child === newTile || !child._voxMesh) return;
      
      // Skip if child doesn't have proper methods
      if(!child.getWorldPosition || typeof child.getWorldPosition !== 'function') return;
      
      // Simple heuristic: if tiles are very close in the hierarchy, they likely overlap
      // Google 3D tiles typically replace tiles at the same location with higher detail
      // We can check if the tiles share similar world position
      try {
        const newPos = new THREE.Vector3();
        const existingPos = new THREE.Vector3();
        
        newTile.getWorldPosition(newPos);
        child.getWorldPosition(existingPos);
        
        const distance = newPos.distanceTo(existingPos);
        
        // Google 3D tiles are typically around 100-200 units in size
        // If tiles are within 50 units, they're likely the same location at different detail levels
        if(distance < 50) {
          tilesToClean.push(child);
        }
      } catch(e) {
        // Skip if position can't be determined
      }
    });
  }
  
  // Clean up identified overlapping tiles
  tilesToClean.forEach(tile => cleanupTileVoxels(tile));
}

/* ─────────────────────── visibility resolver ─────────────────────── */
function applyVis(tile){
  // Skip if not a valid tile
  if(!tile || !tiles || !tiles.group) return;
  
  // Verify tile is a valid Three.js object
  if(typeof tile.type !== 'string' || tile.visible === undefined) return;
  
  // Only apply to direct children of tiles.group
  if(tile.parent !== tiles.group) return;
  
  const showV = state.vox && !state.mc;
  const showM = state.vox &&  state.mc;
  const hasVoxelVersion = tile._voxMesh || tile._mcMesh;
  
  // Hide original tile if voxel version exists and vox mode is on
  tile.visible = state.vox ? !hasVoxelVersion : true;

  if(tile._voxMesh && tile._voxMesh.visible !== undefined) {
    tile._voxMesh.visible = showV;
  }
  if(tile._mcMesh && tile._mcMesh.visible !== undefined) {
    tile._mcMesh.visible = showM;
  }
}

function updateVis(){
  if(!scene || !tiles || !tiles.group) return;
  
  // Update visibility for all tiles - use children array instead of traverse to avoid errors
  const tilesToProcess = [];
  if(tiles.group.children) {
    tiles.group.children.forEach(child => {
      if(child && child.type === 'Group') {
        tilesToProcess.push(child);
      }
    });
  }
  
  // Process collected tiles
  tilesToProcess.forEach(tile => {
    applyVis(tile);
    
    // If vox mode is on and tile doesn't have voxels, create them
    if(state.vox && !tile._voxMesh && !voxelizingTiles.has(tile) && tile.visible) {
      buildVoxelFor(tile);
    }
  });
  
  // Also update any standalone voxel meshes
  const meshesToUpdate = [];
  scene.children.forEach(child => {
    if(child && child.userData && child.userData.sourceTile) {
      meshesToUpdate.push(child);
    }
  });
  
  meshesToUpdate.forEach(mesh => {
    const tile = mesh.userData.sourceTile;
    if(tile) {
      if(tile._voxMesh === mesh) {
        mesh.visible = state.vox && !state.mc;
      } else if(tile._mcMesh === mesh) {
        mesh.visible = state.vox && state.mc;
      }
    }
  });
}

function rebuildAll(){
  if(!scene || !tiles || !tiles.group) return;
  
  // Clean up all voxel data - use children array to avoid traverse errors
  const tilesToClean = [];
  if(tiles.group.children) {
    tiles.group.children.forEach(child => {
      if(child && (child._voxMesh || child._mcMesh || child._tempContainer)) {
        tilesToClean.push(child);
      }
    });
  }
  
  // Clean up collected tiles
  tilesToClean.forEach(tile => {
    cleanupTileVoxels(tile);
  });
  
  // Clear the tracking sets
  voxelizingTiles.clear();
  disposingTiles.clear();
  
  // Trigger visibility update which will recreate voxels if needed
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
  
  // If vox mode is already on, prepare for immediate voxelization
  if(state.vox) {
    lastVoxelUpdateTime = 0; // Reset timer to trigger immediate checks
  }
};

/* ───────────────────────── render loop ───────────────────────────── */
const VOXEL_UPDATE_INTERVAL = 100; // Check more frequently for smoother updates

function loop(){
  requestAnimationFrame(loop);
  controls.update();
  
  if(tiles){ 
    camera.updateMatrixWorld(); 
    tiles.update();
    
    // Periodically check for new tiles to voxelize
    const now = performance.now();
    if(state.vox && now - lastVoxelUpdateTime > VOXEL_UPDATE_INTERVAL) {
      lastVoxelUpdateTime = now;
      
      // Check for tiles that need voxelization
      if(tiles.group && tiles.group.children) {
        const tilesToVoxelize = [];
        
        tiles.group.children.forEach(tile => {
          if(tile && tile.type === 'Group' && tile.visible && 
             !tile._voxMesh && !voxelizingTiles.has(tile) && !disposingTiles.has(tile)) {
            tilesToVoxelize.push(tile);
          }
        });
        
        // Sort by distance from camera for better prioritization
        if(tilesToVoxelize.length > 0) {
          const camPos = camera.position;
          tilesToVoxelize.sort((a, b) => {
            const aPos = new THREE.Vector3();
            const bPos = new THREE.Vector3();
            a.getWorldPosition(aPos);
            b.getWorldPosition(bPos);
            return aPos.distanceToSquared(camPos) - bPos.distanceToSquared(camPos);
          });
          
          // Voxelize up to 3 tiles at a time to avoid blocking
          tilesToVoxelize.slice(0, 3).forEach(tile => buildVoxelFor(tile));
        }
      }
    }
  }
  
  renderer.render(scene,camera);
}