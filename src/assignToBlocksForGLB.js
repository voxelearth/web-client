// assignToBlocksForGLB.js
// Drop‑in upgrade: shared atlas + OKLab + color cache (no 960px assumptions)

import * as THREE from 'three';

/*
Globals:
- VANILLA_ATLAS: loaded from /vanilla.atlas
- textureCache: map of keys -> THREE.Texture (we mainly keep a shared atlas and per-block clones)
- BLOCKS: [{ name, rgb:{r,g,b}, oklab:{L,a,b}, uv:{offsetX, offsetY, repeatX, repeatY}, mat?:THREE.Material }]
- kdTree: KD over OKLab
*/

let VANILLA_ATLAS = null;
const textureCache = {};
let BLOCKS = [];
let kdTree = null;

// Bias towards brighter/darker blocks during matching (OKLab L adjustment)
// Recommended external usage range: -0.20 .. +0.20
let MC_BRIGHTNESS_BIAS = 0.1; // Slightly brighter than normal! Helps the MC bias towards dark blocks
export function setMinecraftBrightnessBias(bias){
  MC_BRIGHTNESS_BIAS = Math.max(-0.5, Math.min(0.5, +bias || 0));
  console.log('[MC] brightness bias set to', MC_BRIGHTNESS_BIAS);
}
export function getMinecraftBrightnessBias(){ return MC_BRIGHTNESS_BIAS; }

const BLOCK_SIZE = 16; // 16×16 textures
const loader = new THREE.TextureLoader();

// ---- Tunables ---------------------------------------------------------
const USE_OKLAB = true;                 // perceptual color space
const ALPHA_MEAN_THRESHOLD = 0.10;      // ignore mostly transparent pixels in color avg
const LOOKUP_QUANT = { r: 32, g: 64, b: 32 }; // 5-6-5 cache
// ----------------------------------------------------------------------

// A single atlas texture we clone per material (shared image)
async function getSharedAtlasTexture() {
  if (textureCache.__sharedAtlas) return textureCache.__sharedAtlas;
  const tex = await loader.loadAsync(`/vanilla.png`);
  // Pixel-art settings
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false; // we'll compute UVs in top-left image space
  textureCache.__sharedAtlas = tex;
  return tex;
}

// Load atlas JSON (no hardcoded size)
async function loadVanillaAtlas() {
  if (VANILLA_ATLAS) return;
  const resp = await fetch('/vanilla.atlas');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  VANILLA_ATLAS = await resp.json();
}

// Compute the 16×16 window (inside padded cell) for a block
function atlasWindowFor(info, atlasW, atlasH, cellsPerRow) {
  // Each cell is atlasW/cells; 16×16 sits in the center with equal margins
  const cellW = atlasW / cellsPerRow;
  const cellH = atlasH / cellsPerRow;   // should be equal, but don't assume
  const marginX = (cellW - BLOCK_SIZE) / 2;
  const marginY = (cellH - BLOCK_SIZE) / 2;

  const sx = info.atlasColumn * cellW + marginX;
  const sy = info.atlasRow    * cellH + marginY;

  return { sx, sy, sw: BLOCK_SIZE, sh: BLOCK_SIZE };
}

// Compute normalized offset/repeat for `KHR_texture_transform`
function uvTransformFromWindow(win, atlasW, atlasH) {
  const offsetX = win.sx / atlasW;
  const offsetY = win.sy / atlasH;              // we set flipY=false, so top-left origin
  const repeatX = win.sw / atlasW;
  const repeatY = win.sh / atlasH;
  return { offsetX, offsetY, repeatX, repeatY };
}

// Average color from that 16×16 window (alpha-weighted)
function meanColorFromAtlasRegion(atlasImg, win) {
  const canvas = document.createElement('canvas');
  canvas.width = win.sw; canvas.height = win.sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(atlasImg, win.sx, win.sy, win.sw, win.sh, 0, 0, win.sw, win.sh);
  const data = ctx.getImageData(0, 0, win.sw, win.sh).data;
  let R = 0, G = 0, B = 0, Aw = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < ALPHA_MEAN_THRESHOLD) continue;
    R += data[i] * a;
    G += data[i + 1] * a;
    B += data[i + 2] * a;
    Aw += a;
  }
  if (Aw <= 1e-6) return { r: 0, g: 0, b: 0 };
  return { r: (R / Aw) / 255, g: (G / Aw) / 255, b: (B / Aw) / 255 };
}

// sRGB->linear (for OKLab)
function toLinear(c) {
  return (c <= 0.04045) ? (c / 12.92) : Math.pow((c + 0.055) / 1.055, 2.4);
}

// sRGB (0..1) → OKLab
function rgbToOKLab(r, g, b) {
  // linearize first
  const rl = toLinear(r), gl = toLinear(g), bl = toLinear(b);
  const l = 0.4122214708*rl + 0.5363325363*gl + 0.0514459929*bl;
  const m = 0.2119034982*rl + 0.6806995451*gl + 0.1073969566*bl;
  const s = 0.0883024619*rl + 0.2817188376*gl + 0.6299787005*bl;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
    a: 1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
    b: 0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_
  };
}

// Apply brightness bias (L channel shift) to a Lab object in-place
function applyBrightnessBias(lab){
  lab.L = Math.min(1, Math.max(0, lab.L + MC_BRIGHTNESS_BIAS));
  return lab;
}

// Build a per-block material that samples the shared atlas at a sub-rect
function makeBlockMaterial(sharedAtlas, uv) {
  const tex = sharedAtlas.clone(); // clones sampler/transform, keeps same image
  tex.needsUpdate = true;
  tex.offset.set(uv.offsetX, uv.offsetY);
  tex.repeat.set(uv.repeatX, uv.repeatY);
  tex.center.set(0, 0);
  // Pixel-art settings (clone doesn’t inherit filters reliably on all drivers)
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;

  return new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.FrontSide
  });
}

/*******************************************************
 * 1) LOAD ATLAS, PREPARE BLOCKS WITH UV TRANSFORMS
 ******************************************************/
async function loadAllBlocks() {
  await loadVanillaAtlas();
  const sharedAtlas = await getSharedAtlasTexture();
  const atlasImg = sharedAtlas.image;
  const atlasW = atlasImg.width;
  const atlasH = atlasImg.height;
  const cells = VANILLA_ATLAS.atlasSize | 0;

  const blocks = VANILLA_ATLAS.blocks || [];
  const out = [];

  // We only consider entries that also exist in textures map
  await Promise.all(blocks.map(async (b) => {
    const raw = b.name.replace('minecraft:', '');
    const atlasKey = `minecraft:block/${raw}`;
    const info = VANILLA_ATLAS.textures?.[atlasKey];
    if (!info) return; // skip things not mapped in the atlas

    // Compute 16×16 window and uv transform
    const win = atlasWindowFor(info, atlasW, atlasH, cells);
    const uv = uvTransformFromWindow(win, atlasW, atlasH);

    // Average color from the exact 16×16 we will sample
    const rgb = meanColorFromAtlasRegion(atlasImg, win);
    const okl = USE_OKLAB ? rgbToOKLab(rgb.r, rgb.g, rgb.b) : null;

    out.push({
      name: raw,
      rgb,
      oklab: okl,
      uv,
      // lazily create material per block when we actually build geometry
      material: null
    });
  }));

  BLOCKS = out;
}

/*******************************************************
 * 2) K-D TREE (OKLab)
 ******************************************************/
class KDTreeNode {
  constructor(blockIndex, axis = null, left = null, right = null) {
    this.blockIndex = blockIndex;
    this.axis = axis; // 0 -> L, 1 -> a, 2 -> b
    this.left = left;
    this.right = right;
  }
}
function axisKey(axis) { return axis === 0 ? 'L' : (axis === 1 ? 'a' : 'b'); }

function buildKDTree(indices, depth = 0) {
  if (!indices.length) return null;
  const axis = depth % 3;
  indices.sort((ia, ib) => {
    const A = BLOCKS[ia].oklab[axisKey(axis)];
    const B = BLOCKS[ib].oklab[axisKey(axis)];
    return A - B;
  });
  const mid = Math.floor(indices.length / 2);
  return new KDTreeNode(
    indices[mid],
    axis,
    buildKDTree(indices.slice(0, mid), depth + 1),
    buildKDTree(indices.slice(mid + 1), depth + 1)
  );
}

function nearestNeighbor(node, L, a, b, best = { d2: Infinity, idx: -1 }) {
  if (!node) return best;
  const bk = BLOCKS[node.blockIndex].oklab;
  const dL = bk.L - L, da = bk.a - a, db = bk.b - b;
  const d2 = dL*dL + da*da + db*db;
  if (d2 < best.d2) { best.d2 = d2; best.idx = node.blockIndex; }

  const axis = node.axis;
  const queryVal = axis === 0 ? L : (axis === 1 ? a : b);
  const nodeVal  = axis === 0 ? bk.L : (axis === 1 ? bk.a : bk.b);
  const first = queryVal < nodeVal ? node.left : node.right;
  const second = queryVal < nodeVal ? node.right : node.left;

  best = nearestNeighbor(first, L, a, b, best);
  const delta = queryVal - nodeVal;
  if (delta*delta < best.d2) best = nearestNeighbor(second, L, a, b, best);
  return best;
}

function buildBlockKDTree() {
  // filter: only blocks with oklab computed
  const idx = BLOCKS.map((_, i) => i).filter(i => !!BLOCKS[i].oklab);
  kdTree = buildKDTree(idx, 0);
}

/*******************************************************
 * 3) PUBLIC: init + assign
 ******************************************************/
export async function initBlockData() {
  if (BLOCKS.length && kdTree) return;
  await loadAllBlocks();
  if (!BLOCKS.length) {
    console.error('No blocks loaded from atlas.');
    return;
  }
  buildBlockKDTree();
  // Pre-load shared atlas so we don’t hiccup on the first material clone
  await getSharedAtlasTexture();
}

/**
 * assignVoxelsToBlocks(glbDisplay)
 * Build one mesh per block (grouped faces), but all materials point
 * to the **same** atlas image with offset/repeat (KHR_texture_transform).
 * Includes an O(1) color cache to avoid repeated k-d queries.
 */
export async function assignVoxelsToBlocks(glbDisplay) {
  if (!kdTree) {
    await initBlockData();
    if (!kdTree) return;
  }
  const voxelGrid = glbDisplay._voxelGrid;
  if (!voxelGrid) { console.error('No voxel grid. Run voxelize() first.'); return; }

  const { gridSize, unit, bbox, voxelColors, voxelCounts } = voxelGrid;
  const total = gridSize.x * gridSize.y * gridSize.z;

  // --- quantized color cache (5-6-5) ---
  const cache = new Int32Array(LOOKUP_QUANT.r * LOOKUP_QUANT.g * LOOKUP_QUANT.b);
  cache.fill(-1);
  const keyFor = (r, g, b) => {
    const R = Math.min(LOOKUP_QUANT.r - 1, Math.max(0, (r * LOOKUP_QUANT.r) | 0));
    const G = Math.min(LOOKUP_QUANT.g - 1, Math.max(0, (g * LOOKUP_QUANT.g) | 0));
    const B = Math.min(LOOKUP_QUANT.b - 1, Math.max(0, (b * LOOKUP_QUANT.b) | 0));
    return R + LOOKUP_QUANT.r * (G + LOOKUP_QUANT.g * B);
  };

  // Face templates
  const faceDefs = [
    {nx:0, ny:0, nz:1,  verts:[[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]]}, // +Z
    {nx:0, ny:0, nz:-1, verts:[[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5]]}, // -Z
    {nx:1, ny:0, nz:0,  verts:[[0.5,-0.5,0.5],[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5]]}, // +X
    {nx:-1,ny:0, nz:0,  verts:[[-0.5,-0.5,-0.5],[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5]]}, // -X
    {nx:0, ny:1, nz:0,  verts:[[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5],[-0.5,0.5,-0.5]]},   // +Y
    {nx:0, ny:-1,nz:0,  verts:[[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5],[-0.5,-0.5,0.5]]}, // -Y
  ];
  const uvTemplate = [0,0, 1,0, 1,1, 0,1];

  function idxXYZ(x,y,z) { return x + gridSize.x*(y + gridSize.y*z); }

  // Groups per block index
  const groups = {}; // bIdx -> { positions:[], uvs:[], indices:[], count:0 }

  const findNearestBlockIdx = (r, g, b) => {
    // cache key in sRGB space (input is already sRGB 0..1)
    const k = keyFor(r, g, b);
    const cached = cache[k];
    if (cached >= 0) return cached;

  const lab = USE_OKLAB ? applyBrightnessBias(rgbToOKLab(r,g,b)) : { L:r, a:g, b };
  const best = nearestNeighbor(kdTree, lab.L, lab.a, lab.b);
    cache[k] = best.idx;
    return best.idx;
  };

  // Iterate voxels (alpha threshold handled during voxelization; we still check)
  for (let i = 0; i < total; i++) {
    const cnt = voxelCounts[i];
    if (!cnt) continue;

    const r = voxelColors[i*4+0] / cnt;
    const g = voxelColors[i*4+1] / cnt;
    const b = voxelColors[i*4+2] / cnt;
    const a = voxelColors[i*4+3] / cnt;
    if (a < 0.1) continue;

    const bIdx = findNearestBlockIdx(r, g, b);
    if (bIdx < 0) continue;

    // find voxel xyz
    const z = Math.floor(i / (gridSize.x * gridSize.y));
    const rem = i - z * gridSize.x * gridSize.y;
    const y = Math.floor(rem / gridSize.x);
    const x = rem - y * gridSize.x;

    const cx = bbox.min.x + (x + 0.5) * unit.x;
    const cy = bbox.min.y + (y + 0.5) * unit.y;
    const cz = bbox.min.z + (z + 0.5) * unit.z;

    for (const face of faceDefs) {
      const nx = x + face.nx, ny = y + face.ny, nz = z + face.nz;
      if (
        nx >= 0 && nx < gridSize.x &&
        ny >= 0 && ny < gridSize.y &&
        nz >= 0 && nz < gridSize.z
      ) {
        const ni = idxXYZ(nx, ny, nz);
        // neighbor present and matched to same block? cull this face
        const nCnt = voxelCounts[ni];
        if (nCnt) {
          // We don’t know neighbor’s block without re‑query. Use heuristic: if its color is very close to ours,
          // we’ll likely map to the same block. This avoids a second k‑d lookup per neighbor.
          const nr = voxelColors[ni*4+0] / nCnt;
          const ng = voxelColors[ni*4+1] / nCnt;
          const nb = voxelColors[ni*4+2] / nCnt;
          const dr = nr - r, dg = ng - g, db = nb - b;
          if (dr*dr + dg*dg + db*db < 1e-4) continue; // cull
          // If you want exact culling, do: if (findNearestBlockIdx(nr,ng,nb) === bIdx) continue;
        }
      }

      const grp = (groups[bIdx] ||= { positions: [], uvs: [], indices: [], count: 0 });
      for (let v = 0; v < 4; v++) {
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
      grp.count += 4;
    }
  }

  // Build final group with one mesh per block (all sampling the shared atlas)
  const voxelGroup = new THREE.Group();
  voxelGroup.name = 'voxelGroup';

  const sharedAtlas = await getSharedAtlasTexture();

  for (const idxStr in groups) {
    const bIdx = parseInt(idxStr, 10);
    const { positions, uvs, indices } = groups[idxStr];
    if (!positions.length) continue;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    try {
      geom.computeBoundingSphere();
    } catch {}

    const block = BLOCKS[bIdx];
    if (!block.material) block.material = makeBlockMaterial(sharedAtlas, block.uv);
    const mesh = new THREE.Mesh(geom, block.material);
    mesh.frustumCulled = false; // reduces flicker with very large boxes
    voxelGroup.add(mesh);
  }

  // Swap old group
  const old = glbDisplay.getObjectByName('voxelGroup');
  if (old) {
    old.traverse(n => {
      if (n.isMesh) {
        n.geometry?.dispose();
        (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => m?.dispose?.());
      }
    });
    glbDisplay.remove(old);
  }

  glbDisplay.add(voxelGroup);
  glbDisplay.editor?.update?.();

  // Expose for debugging/inspection
  voxelGrid.assigned = undefined; // not needed anymore
}

export { BLOCKS };

/* ------------------------------------------------------------------ */
/* In-place atlas application (UV baking, no shader patch)             */
/* ------------------------------------------------------------------ */

// Basic atlas material (no onBeforeCompile)
function makeAtlasBasicMaterial(sharedAtlas) {
  const mat = new THREE.MeshBasicMaterial({ map: sharedAtlas });
  if ('colorSpace' in sharedAtlas) sharedAtlas.colorSpace = THREE.SRGBColorSpace;
  return mat;
}

// Quantized color cache for per-voxel block indexing
function computeBlockIndexGrid(voxelGrid) {
  const { gridSize, voxelColors, voxelCounts } = voxelGrid;
  const total = gridSize.x * gridSize.y * gridSize.z;
  const out = new Int32Array(total); out.fill(-1);
  const LOOK = { r:32, g:64, b:32 };
  const cache = new Int32Array(LOOK.r*LOOK.g*LOOK.b); cache.fill(-1);
  const keyFor = (r,g,b)=>{
    const R=Math.min(LOOK.r-1, Math.max(0,(r*LOOK.r)|0));
    const G=Math.min(LOOK.g-1, Math.max(0,(g*LOOK.g)|0));
    const B=Math.min(LOOK.b-1, Math.max(0,(b*LOOK.b)|0));
    return R + LOOK.r*(G + LOOK.g*B);
  };
  const findNearest=(r,g,b)=>{ const k=keyFor(r,g,b); const c=cache[k]; if(c>=0) return c; const q=applyBrightnessBias(rgbToOKLab(r,g,b)); const best=nearestNeighbor(kdTree,q.L,q.a,q.b,{d2:Infinity,idx:-1}); cache[k]=best.idx; return best.idx; };
  for (let i=0;i<total;i++) {
    const cnt = voxelCounts[i]; if(!cnt) continue;
    const r = voxelColors[i*4+0]/cnt;
    const g = voxelColors[i*4+1]/cnt;
    const b = voxelColors[i*4+2]/cnt;
    out[i] = findNearest(r,g,b);
  }
  return out;
}

// Optional fallback triangle picker (if voxelGrid missing) using existing vertex colors
function makeColorFallbackPicker(querySpace='srgb') {
  return (i0,i1,i2, geom) => {
    const col = geom.getAttribute('color');
    if (!col) return -1;
    const r=(col.getX(i0)+col.getX(i1)+col.getX(i2))/3;
    const g=(col.getY(i0)+col.getY(i1)+col.getY(i2))/3;
    const b=(col.getZ(i0)+col.getZ(i1)+col.getZ(i2))/3;
  const q = applyBrightnessBias(rgbToOKLab(r,g,b)); // already linearized inside + bias
    const best = nearestNeighbor(kdTree, q.L, q.a, q.b, { d2:Infinity, idx:-1 });
    return best.idx;
  };
}

// Bake atlas UVs into geometry's existing uv attribute.
function bakeAtlasUVsOnGeometry(geom, voxelGrid, blockIdxGrid, pickBlockForTriangle) {
  const pos = geom.getAttribute('position');
  if (!pos) return;
  let uv = geom.getAttribute('uv');
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geom.setAttribute('uv', uv);
  }
  if (!geom.userData) geom.userData = {};
  if (!geom.userData.__origUv) geom.userData.__origUv = uv.clone();

  const index = geom.getIndex();
  const triCount = index ? (index.count / 3 | 0) : (pos.count / 3 | 0);
  const getIdx = (k) => index ? index.getX(k) : k;

  let invUnit, bbMin, gSize;
  if (voxelGrid) {
    invUnit = new THREE.Vector3(1/voxelGrid.unit.x, 1/voxelGrid.unit.y, 1/voxelGrid.unit.z);
    bbMin   = voxelGrid.bbox.min;
    gSize   = voxelGrid.gridSize;
  }

  const v0=new THREE.Vector3(), v1=new THREE.Vector3(), v2=new THREE.Vector3();
  const e1=new THREE.Vector3(), e2=new THREE.Vector3(), n=new THREE.Vector3();
  const tmp=new THREE.Vector3();
  const eps = 1e-4;
  function voxelIndexFromPoint(p, normal) {
    if (!voxelGrid) return -1;
    tmp.copy(p).addScaledVector(normal, -eps);
    const lx=(tmp.x-bbMin.x)*invUnit.x;
    const ly=(tmp.y-bbMin.y)*invUnit.y;
    const lz=(tmp.z-bbMin.z)*invUnit.z;
    const xi=Math.floor(lx), yi=Math.floor(ly), zi=Math.floor(lz);
    if (xi<0||yi<0||zi<0||xi>=gSize.x||yi>=gSize.y||zi>=gSize.z) return -1;
    return xi + gSize.x*(yi + gSize.y*zi);
  }

  function writeFaceLocalUV(vi, axis, sign, cellI, p) {
    let fx=0.5, fy=0.5, fz=0.5;
    if (voxelGrid) {
      fx = (p.x - bbMin.x) * invUnit.x - cellI.x;
      fy = (p.y - bbMin.y) * invUnit.y - cellI.y;
      fz = (p.z - bbMin.z) * invUnit.z - cellI.z;
    }
    let U,V;
    if (axis===0) { U = (sign>0)?fz:1-fz; V = fy; }
    else if (axis===1) { U = fx; V = (sign>0)?fz:1-fz; }
    else { U = (sign>0)?fx:1-fx; V = fy; }
    uv.setXY(vi, THREE.MathUtils.clamp(U,0,1), THREE.MathUtils.clamp(V,0,1));
  }

  for (let t=0; t<triCount; t++) {
    const i0=getIdx(3*t+0), i1=getIdx(3*t+1), i2=getIdx(3*t+2);
    v0.fromBufferAttribute(pos,i0); v1.fromBufferAttribute(pos,i1); v2.fromBufferAttribute(pos,i2);
    e1.subVectors(v1,v0); e2.subVectors(v2,v0); n.crossVectors(e1,e2);
    if (n.lengthSq() < 1e-20) continue; n.normalize();
    const ax=Math.abs(n.x), ay=Math.abs(n.y), az=Math.abs(n.z);
    let axis=2, sign=Math.sign(n.z);
    if (ax>ay && ax>az) { axis=0; sign=Math.sign(n.x); }
    else if (ay>az) { axis=1; sign=Math.sign(n.y); }

    let blockIdx = -1;
    if (voxelGrid && blockIdxGrid) {
      const cx=(v0.x+v1.x+v2.x)/3, cy=(v0.y+v1.y+v2.y)/3, cz=(v0.z+v1.z+v2.z)/3;
      const cell = voxelIndexFromPoint(tmp.set(cx,cy,cz), n);
      if (cell>=0) blockIdx = blockIdxGrid[cell];
    } else if (pickBlockForTriangle) {
      blockIdx = pickBlockForTriangle(i0,i1,i2, geom);
    }
    if (blockIdx < 0) continue;
    const rect = BLOCKS[blockIdx].uv;

    const p0 = new THREE.Vector3().fromBufferAttribute(pos,i0);
    const p1 = new THREE.Vector3().fromBufferAttribute(pos,i1);
    const p2 = new THREE.Vector3().fromBufferAttribute(pos,i2);
    const cellI = { x:0, y:0, z:0 };
    if (voxelGrid) {
      const lx=(p0.x-bbMin.x)*invUnit.x; const ly=(p0.y-bbMin.y)*invUnit.y; const lz=(p0.z-bbMin.z)*invUnit.z;
      cellI.x=Math.floor(lx); cellI.y=Math.floor(ly); cellI.z=Math.floor(lz);
    }
    writeFaceLocalUV(i0, axis, sign, cellI, p0);
    writeFaceLocalUV(i1, axis, sign, cellI, p1);
    writeFaceLocalUV(i2, axis, sign, cellI, p2);
    const u0=uv.getX(i0), v0_=uv.getY(i0);
    const u1=uv.getX(i1), v1_=uv.getY(i1);
    const u2=uv.getX(i2), v2_=uv.getY(i2);
    uv.setXY(i0, rect.offsetX + u0*rect.repeatX, rect.offsetY + v0_*rect.repeatY);
    uv.setXY(i1, rect.offsetX + u1*rect.repeatX, rect.offsetY + v1_*rect.repeatY);
    uv.setXY(i2, rect.offsetX + u2*rect.repeatX, rect.offsetY + v2_*rect.repeatY);
  }
  try { geom.computeBoundingSphere?.(); } catch {}
  geom.attributes.uv.needsUpdate = true;
}

export async function applyAtlasToExistingVoxelMesh(voxelMesh, voxelGrid) {
  await initBlockData();
  if (!kdTree || !BLOCKS.length || !voxelMesh) return;
  const blockIdxGrid = (voxelGrid && voxelGrid.gridSize) ? computeBlockIndexGrid(voxelGrid) : null;
  const atlas = await getSharedAtlasTexture();
  const mcMat = makeAtlasBasicMaterial(atlas);
  const allowApply = !!(voxelMesh.userData && voxelMesh.userData.__mcAllowApply);
  voxelMesh.traverse(n => {
    if (!n.isMesh || !n.geometry) return;
    if (!n.userData.origMat) n.userData.origMat = n.material;
    const picker = blockIdxGrid ? null : makeColorFallbackPicker('srgb');
    bakeAtlasUVsOnGeometry(n.geometry, voxelGrid || null, blockIdxGrid, picker);
    if (allowApply) {
      n.material = mcMat;
      n.userData.mcMat = mcMat; // allow toggling back without re-bake
    }
    n.frustumCulled = false;
  });
  if (allowApply) {
    voxelMesh.userData.__mcBiasUsed = getMinecraftBrightnessBias();
  }
}

export function restoreVoxelOriginalMaterial(voxelMesh) {
  if (!voxelMesh) return;
  voxelMesh.traverse(n => {
    if (n.isMesh && n.userData?.origMat) {
      const bak = n.geometry?.userData?.__origUv;
      if (bak) n.geometry.setAttribute('uv', bak.clone());
      n.material = n.userData.origMat;
    }
  });
}
