// assignToBlocksForGLB.js
// Optimized approach using a k-d tree for color lookups and real 16x16 textures.

import * as THREE from 'three';

/*
Global-ish: 
- VANILLA_ATLAS: loaded from /vanilla.atlas
- textureCache: map of blockName -> loaded THREE.Texture
- BLOCKS: array of { name, r, g, b, texture }
- kdTree: a k-d tree built from BLOCKS
*/

let VANILLA_ATLAS = null;
const textureCache = {};
let BLOCKS = [];
let kdTree = null;

// Used for real 16×16 extraction from the 960×960 "vanilla.png"
const ATLAS_IMAGE_SIZE = 960; // If yours is different, adjust
const BLOCK_SIZE = 16;        // block textures are 16×16
const loader = new THREE.TextureLoader();

/*******************************************************
 * 1) LOAD ATLAS, PREPARE BLOCKS WITH REAL TEXTURES
 ******************************************************/

/**
 * Load the /vanilla.atlas JSON if not already loaded.
 */
async function loadVanillaAtlas() {
  if (VANILLA_ATLAS) return;
  try {
    const resp = await fetch('/vanilla.atlas');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    VANILLA_ATLAS = await resp.json();
    console.log("Loaded vanilla.atlas:", VANILLA_ATLAS);
  } catch (err) {
    console.error("Failed to load /vanilla.atlas:", err);
  }
}

/**
 * Attempt to load (or retrieve) the real 16x16 texture for a block,
 * with fallback from the atlas, etc.
 */
async function loadBlockTexture(blockName, blockColor) {
  // If cache has it, return
  if (textureCache[blockName]) return textureCache[blockName];

  // Try direct path first:
  const directUrl = `/1.20/assets/minecraft/textures/block/${blockName}.png`;
  try {
    const tex = await loader.loadAsync(directUrl);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    textureCache[blockName] = tex;
    return tex;
  } catch (err) {
    // fallback to atlas
  }

  // If no atlas, load it
  if (!VANILLA_ATLAS) {
    await loadVanillaAtlas();
    if (!VANILLA_ATLAS) return null;
  }

  // We also want the big "vanilla.png"
  if (!textureCache["vanillaAtlas"]) {
    try {
      const atlasTex = await loader.loadAsync(`/vanilla.png`);
      atlasTex.magFilter = THREE.NearestFilter;
      atlasTex.minFilter = THREE.NearestFilter;
      textureCache["vanillaAtlas"] = atlasTex;
    } catch (err) {
      console.error("Failed to load /vanilla.png:", err);
      return null;
    }
  }

  const atlasTex = textureCache["vanillaAtlas"];
  // Locate the block in the atlas:
  const atlasKey = `minecraft:block/${blockName}`;
  let info = VANILLA_ATLAS.textures[atlasKey];
  if (!info) {
    // Possibly the block is listed in the top-level blocks array:
    // We'll do a search by name if needed, but let's just skip if not found
    // or see if we can guess a fallback. 
    return null;
  }
  // Each atlas cell is e.g. 48×48 if atlasSize=20 => 960/20=48
  const cellsPerRow = VANILLA_ATLAS.atlasSize;
  const cellSize = ATLAS_IMAGE_SIZE/cellsPerRow; // e.g. 48
  const margin = (cellSize - BLOCK_SIZE)/2;      // e.g. (48-16)/2=16
  const sx = info.atlasColumn * cellSize + margin;
  const sy = info.atlasRow * cellSize + margin;

  // Extract subregion
  const canvas = document.createElement('canvas');
  canvas.width = BLOCK_SIZE;
  canvas.height = BLOCK_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    atlasTex.image,
    sx, sy, BLOCK_SIZE, BLOCK_SIZE,
    0, 0, BLOCK_SIZE, BLOCK_SIZE
  );
  const subTex = new THREE.CanvasTexture(canvas);
  subTex.magFilter = THREE.NearestFilter;
  subTex.minFilter = THREE.NearestFilter;
  textureCache[blockName] = subTex;
  return subTex;
}

/**
 * Build the big BLOCKS array, each with { name, r,g,b, texture }.
 * We'll do so from VANILLA_ATLAS.blocks, each with colour:{r,g,b}.
 */
async function loadAllBlocks() {
  await loadVanillaAtlas();
  if (!VANILLA_ATLAS) return;

  const blockList = VANILLA_ATLAS.blocks || [];
  const results = [];
  // We'll parallelize a bit by building an array of Promises.
  const loadPromises = blockList.map(async (b) => {
    // b: { name, colour:{r,g,b} }
    const rawName = b.name.replace("minecraft:", "");
    const color = b.colour;
    let tex = await loadBlockTexture(rawName, color);
    // If not found, skip
    if (!tex) {
      return null;
    }
    return {
      name: rawName, // store w/o "minecraft:" prefix
      r: color.r, g: color.g, b: color.b,
      texture: tex
    };
  });
  const blockData = await Promise.all(loadPromises);
  for (const item of blockData) {
    if (item) results.push(item);
  }
  BLOCKS = results;
  console.log("Loaded real textures for blocks:", BLOCKS.length);
}

/////////////////////////////////////////////////////////
// 2) K-D TREE for [r,g,b] data
/////////////////////////////////////////////////////////

/**
 * Simple K-D tree structure for 3D color vectors.
 * We'll build from BLOCKS' r,g,b in [0..1].
 * Then do nearest neighbor queries in O(log B).
 */

class KDTreeNode {
  constructor(blockIndex, axis=null, left=null, right=null) {
    this.blockIndex = blockIndex; // index into BLOCKS
    this.axis = axis; // 0->r,1->g,2->b
    this.left = left;
    this.right = right;
  }
}

/**
 * Build the k-d tree from the array BLOCKS. Returns root node.
 */
function buildKDTree(indices, depth=0) {
  if (!indices.length) return null;
  const axis = depth % 3; // 0->r,1->g,2->b
  // Sort indices by that axis
  indices.sort((a, b) => {
    return BLOCKS[a][axisKey(axis)] - BLOCKS[b][axisKey(axis)];
  });
  const median = Math.floor(indices.length/2);
  const nodeIndex = indices[median];
  const left = indices.slice(0, median);
  const right = indices.slice(median+1);

  const leftNode = buildKDTree(left, depth+1);
  const rightNode = buildKDTree(right, depth+1);

  return new KDTreeNode(nodeIndex, axis, leftNode, rightNode);
}

/**
 * nearestNeighborSearch
 * r,g,b in [0..1].
 */
function nearestNeighborSearch(node, r, g, b, best={ dist:Infinity, blockIndex:-1 }, depth=0) {
  if (!node) return best;
  const axis = node.axis;
  const bx = BLOCKS[node.blockIndex];
  const dr = (bx.r - r);
  const dg = (bx.g - g);
  const db = (bx.b - b);
  const distSq = dr*dr + dg*dg + db*db;
  if (distSq < best.dist) {
    best.dist = distSq;
    best.blockIndex = node.blockIndex;
  }
  const axisVal = axis===0 ? r : (axis===1 ? g : b);
  const nodeVal = axis===0 ? bx.r : (axis===1 ? bx.g : bx.b);

  let sideA, sideB;
  if (axisVal < nodeVal) {
    sideA = node.left;
    sideB = node.right;
  } else {
    sideA = node.right;
    sideB = node.left;
  }
  best = nearestNeighborSearch(sideA, r, g, b, best, depth+1);
  // Possibly check the other side if the hyperplane distance < best.dist
  const delta = axisVal - nodeVal;
  if (delta*delta < best.dist) {
    best = nearestNeighborSearch(sideB, r, g, b, best, depth+1);
  }
  return best;
}

function axisKey(axis) {
  // 0->'r',1->'g',2->'b'
  return (axis===0 ? 'r' : (axis===1?'g':'b'));
}

/**
 * Initialize the kdTree. 
 */
function buildBlockKDTree() {
  const indices = BLOCKS.map((_, i) => i);
  kdTree = buildKDTree(indices, 0);
  console.log("k-d tree built. # of blocks:", indices.length);
}

/**
 * Returns the best block index for the given color in [0..1].
 */
function findNearestBlockIndex(r, g, b) {
  if (!kdTree) return -1;
  const best = nearestNeighborSearch(kdTree, r, g, b);
  return best.blockIndex;
}

/////////////////////////////////////////////////////////
// 3) MAIN: Precompute + assignVoxels
/////////////////////////////////////////////////////////

/**
 * Called once at startup to ensure:
 *  - loadAllBlocks() has real textures
 *  - buildBlockKDTree() is done
 */
export async function initBlockData() {
  if (BLOCKS.length && kdTree) return; 
  await loadAllBlocks();
  if (!BLOCKS.length) {
    console.error("No blocks loaded. Aborting kdTree build.");
    return;
  }
  buildBlockKDTree();
}

/**
 * assignVoxelsToBlocks( glbDisplay )
 *  - uses the kdTree to map each voxel color → nearest block
 *  - rebuilds a voxelGroup with real textures (one mesh per block).
 */
export async function assignVoxelsToBlocks(glbDisplay) {
  if (!kdTree) {
    await initBlockData();
    if (!kdTree) return;
  }
  const voxelGrid = glbDisplay._voxelGrid;
  if (!voxelGrid) {
    console.error("No voxel grid. Run voxelize() first.");
    return;
  }

  const { gridSize, unit, bbox, voxelColors, voxelCounts } = voxelGrid;
  const alphaThreshold = 0.1;
  const total = gridSize.x*gridSize.y*gridSize.z;

  // Map each voxel → blockIndex
  const assigned = new Int32Array(total);
  assigned.fill(-1);

  for (let i=0; i<total; i++){
    const cnt = voxelCounts[i];
    if (!cnt) continue;
    const r = voxelColors[i*4+0]/cnt;
    const g = voxelColors[i*4+1]/cnt;
    const b = voxelColors[i*4+2]/cnt;
    const a = voxelColors[i*4+3]/cnt;
    if (a<alphaThreshold) continue;
    const idx = findNearestBlockIndex(r,g,b);
    assigned[i] = idx;
  }

  // Group geometry by block index
  const faceDefs = [
    {nx:0, ny:0, nz:1,  verts:[[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]]},
    {nx:0, ny:0, nz:-1, verts:[[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5]]},
    {nx:1, ny:0, nz:0,  verts:[[0.5,-0.5,0.5],[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5]]},
    {nx:-1,ny:0, nz:0,  verts:[[-0.5,-0.5,-0.5],[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5]]},
    {nx:0, ny:1, nz:0,  verts:[[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5],[-0.5,0.5,-0.5]]},
    {nx:0, ny:-1,nz:0,  verts:[[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5],[-0.5,-0.5,0.5]]},
  ];
  const uvTemplate = [ 0,0, 1,0, 1,1, 0,1 ];
  function idxXYZ(x,y,z) {
    return x + gridSize.x*(y + gridSize.y*z);
  }

  const groups = {}; // blockIndex -> { positions, uvs, indices, count }
  for (let z=0; z<gridSize.z; z++){
    for (let y=0; y<gridSize.y; y++){
      for (let x=0; x<gridSize.x; x++){
        const i = idxXYZ(x,y,z);
        const blockIndex = assigned[i];
        if (blockIndex<0) continue; 
        const cx = bbox.min.x + (x+0.5)*unit.x;
        const cy = bbox.min.y + (y+0.5)*unit.y;
        const cz = bbox.min.z + (z+0.5)*unit.z;

        for (const face of faceDefs){
          const nx = x+face.nx;
          const ny = y+face.ny;
          const nz = z+face.nz;
          if (
            nx>=0 && nx<gridSize.x &&
            ny>=0 && ny<gridSize.y &&
            nz>=0 && nz<gridSize.z
          ) {
            const nI = assigned[idxXYZ(nx,ny,nz)];
            if (nI===blockIndex && nI>=0) continue; // same block neighbor
          }
          if (!groups[blockIndex]) {
            groups[blockIndex] = { positions:[], uvs:[], indices:[], count:0 };
          }
          const grp = groups[blockIndex];
          for (let v=0; v<4; v++){
            const vert = face.verts[v];
            grp.positions.push(
              cx + vert[0]*unit.x,
              cy + vert[1]*unit.y,
              cz + vert[2]*unit.z
            );
          }
          grp.uvs.push(...uvTemplate);
          grp.indices.push(
            grp.count, grp.count+1, grp.count+2,
            grp.count, grp.count+2, grp.count+3
          );
          grp.count+=4;
        }
      }
    }
  }

  // Build final group
  const voxelGroup = new THREE.Group();
  for (const idxStr in groups){
    const bIdx = parseInt(idxStr);
    const { positions, uvs, indices } = groups[idxStr];
    if (!positions.length) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeBoundingSphere();

    const block = BLOCKS[bIdx];
    const mat = new THREE.MeshBasicMaterial({
      map: block.texture,
      side: THREE.FrontSide
    });
    const mesh = new THREE.Mesh(geom, mat);
    voxelGroup.add(mesh);
  }

  // Replace old "voxelGroup"
  const old = glbDisplay.getObjectByName("voxelGroup");
  if (old) glbDisplay.remove(old);
  voxelGroup.name = "voxelGroup";
  glbDisplay.add(voxelGroup);
  glbDisplay.editor.update();

  console.log("Voxel mesh rebuilt with real textures. #mesh in group:", voxelGroup.children.length);

  voxelGrid.assigned = assigned;
}

export { BLOCKS };                 // make it importable