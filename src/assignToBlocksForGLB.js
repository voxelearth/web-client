// assignToBlocksForGLB.js
// Drop‑in upgrade: shared atlas + OKLab + color cache (no 960px assumptions)

import * as THREE from 'three';
// Browser-safe NBT shim (pure JS). Provides write()/writeUncompressed().
import * as _nbt from './nbt.js';
const NBT = (_nbt?.write || _nbt?.writeUncompressed) ? _nbt : (_nbt?.default || _nbt);
// Removed: minecraft-data and prismarine-schematic (now writing .schem via direct NBT)

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
let MC_BRIGHTNESS_BIAS = 0; // Slightly brighter than normal! Helps the MC bias towards dark blocks
export function setMinecraftBrightnessBias(bias){
  MC_BRIGHTNESS_BIAS = Math.max(-0.5, Math.min(0.5, +bias || 0));
  console.log('[MC] brightness bias set to', MC_BRIGHTNESS_BIAS);
}
export function getMinecraftBrightnessBias(){ return MC_BRIGHTNESS_BIAS; }

// -- Block filtering (deny/allow with wildcard or RegExp) --------------------
let BLOCK_ALLOW = null; // null means allow everything unless denied
let BLOCK_DENY = [
  /(^|_)ore$/,                         // all ores (incl. deepslate/nether)
  /^ancient_debris$/,                  // netherite "ore"
  /^raw_(iron|gold|copper)_block$/,    // raw-ore blocks
  /^bookshelf$/,                       // library books
  /coral/,                             // any coral block/fan
  /^birch_log$/,                       // birch wood
  /^glowstone$/,                       // glowstone
  /_glazed_terracotta$/,               // all glazed terracotta (incl. the blue/orange ones)

  // transparent & see-through
  /(^|_)glass(_|$)/,          // glass, stained_glass, tinted_glass
  /(^|_)pane(_|$)/,           // glass panes
  /(^|_)ice$/,                // ice
  /^frosted_ice$/,            // frosted ice
  /^barrier$/,                // barrier (invisible)
  /^slime_block$/,            // slime (translucent)
  /^honey_block$/,            // honey (translucent)
  /^sea_lantern$/,            // bright translucent
  /^beacon$/,                 // glassy top
  /^amethyst_cluster$/,       // semi-transparent shards
  /^water$/, /^lava$/         // fluids
];

function _asRegex(rule) {
  if (rule instanceof RegExp) return rule;
  const s = String(rule).trim();
  const esc = s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + esc + '$');
}

function _matches(name, list) {
  return list?.some(rx => _asRegex(rx).test(name));
}

export function setBlockDenylist(list = []) {
  BLOCK_DENY = list.map(_asRegex);
  BLOCKS = [];
  kdTree = null;
}

export function setBlockAllowlist(list = null) {
  BLOCK_ALLOW = list ? list.map(_asRegex) : null;
  BLOCKS = [];
  kdTree = null;
}

export function usePrettyPalette(on = true) {
  if (!on) return setBlockAllowlist(null);
  setBlockAllowlist([
    '*_concrete',
    '*_terracotta',
    '*_wool',
    '*_stained_glass',
    '*_stained_glass_pane',
    'quartz_block',
    'smooth_quartz',
    'stone',
    'smooth_stone',
    'stone_bricks',
    'chiseled_stone_bricks',
    'polished_*',
    'sandstone',
    'cut_sandstone',
    'smooth_sandstone',
    'red_sandstone',
    'cut_red_sandstone',
    'smooth_red_sandstone',
    '*_planks'
  ]);
}

const BLOCK_SIZE = 16; // 16×16 textures
const loader = new THREE.TextureLoader();

// ---- Tunables ---------------------------------------------------------
const USE_OKLAB = true;                 // perceptual color space
const ALPHA_MEAN_THRESHOLD = 0.10;      // ignore mostly transparent pixels in color avg
const LOOKUP_QUANT = { r: 32, g: 64, b: 32 }; // 5-6-5 cache
const VOX_CHUNK_SIZE = 32;
const MAX_DENSE_BLOCK_GRID = 50_000_000; // >200MB for Int32Array, so fallback to chunked beyond this
const BLOCKDATA_CHUNK_BYTES = 1 << 20; // stream .schem data in ~1MB chunks
// If voxel colors are 0..255 instead of 0..1, convert on the fly
function toUnit(cAvg) { return cAvg > 1.0001 ? (cAvg / 255) : cAvg; }
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
  // const sy = info.atlasRow    * cellH + marginY;
const sy = atlasH - (info.atlasRow * cellH + marginY + BLOCK_SIZE);

  return { sx, sy, sw: BLOCK_SIZE, sh: BLOCK_SIZE };
}

// Compute normalized offset/repeat for `KHR_texture_transform`
function uvTransformFromWindow(win, atlasW, atlasH) {
  const offsetX = win.sx / atlasW;
  // flipY=false means WebGL uses bottom-left UV origin; convert top-origin window y to bottom-origin UV
  const offsetY = (atlasH - (win.sy + win.sh)) / atlasH;
  const repeatX = win.sw / atlasW;
  const repeatY = win.sh / atlasH;
  return { offsetX, offsetY, repeatX, repeatY };
}

// Average color from that 16×16 window (alpha-weighted)
function meanColorFromAtlasRegion(atlasImg, win) {
  const canvas = document.createElement('canvas');
  canvas.width = win.sw; canvas.height = win.sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Read using bottom-left origin to match shader sampling (flip Y window)
  const syBL = atlasImg.height - (win.sy + win.sh);
  ctx.drawImage(atlasImg, win.sx, syBL, win.sw, win.sh, 0, 0, win.sw, win.sh);
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

// OKLab for inputs that are ALREADY linear RGB (0..1)
function rgbLinearToOKLab(rl, gl, bl) {
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
  const tex = new THREE.Texture();
  tex.source = sharedAtlas.source;     // 👈 reuse image/source
  tex.needsUpdate = true;
  tex.offset.set(uv.offsetX, uv.offsetY);
  tex.repeat.set(uv.repeatX, uv.repeatY);
  tex.center.set(0, 0);
  // Ensure transform matrix is applied immediately on some drivers
  tex.matrixAutoUpdate = true;
  if (tex.updateMatrix) tex.updateMatrix();
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
    if (BLOCK_ALLOW && BLOCK_ALLOW.length && !_matches(raw, BLOCK_ALLOW)) return;
    if (BLOCK_DENY && BLOCK_DENY.length && _matches(raw, BLOCK_DENY)) return;

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

function iterateVoxelSamples(voxelGrid, fn) {
  if (!voxelGrid || !voxelGrid.gridSize || typeof fn !== 'function') return;
  const NX = voxelGrid.gridSize.x | 0;
  const NY = voxelGrid.gridSize.y | 0;
  const NZ = voxelGrid.gridSize.z | 0;
  const total = NX * NY * NZ;
  const counts = voxelGrid.voxelCounts;
  const colors = voxelGrid.voxelColors;
  if (counts && colors) {
    const len = Math.min(counts.length, total);
    for (let i = 0; i < len; i++) {
      const cnt = counts[i];
      if (!cnt) continue;
      const base = i * 4;
      const x = i % NX;
      const y = ((i / NX) | 0) % NY;
      const z = (i / (NX * NY)) | 0;
      fn({
        x, y, z,
        linearIndex: i,
        count: cnt,
        r: colors[base + 0],
        g: colors[base + 1],
        b: colors[base + 2],
        alpha: colors[base + 3] ?? 1
      });
    }
    return;
  }

  const chunked = voxelGrid?.chunked;
  if (!chunked || !Array.isArray(chunked.chunks)) return;
  const chunkSize = chunked.chunkSize || VOX_CHUNK_SIZE;
  const layer = chunkSize * chunkSize;
  for (const chunk of chunked.chunks) {
    const colorsArr = chunk.colors;
    const alphasArr = chunk.alphas;
    const countsArr = chunk.counts;
    if (!colorsArr || !countsArr) continue;
    const coord = chunk.coord || [0,0,0];
    const cx = coord[0] | 0;
    const cy = coord[1] | 0;
    const cz = coord[2] | 0;
    const baseX = cx * chunkSize;
    const baseY = cy * chunkSize;
    const baseZ = cz * chunkSize;
    const len = countsArr.length;
    for (let i = 0; i < len; i++) {
      const cnt = countsArr[i];
      if (!cnt) continue;
      const lx = i % chunkSize;
      const ly = ((i / chunkSize) | 0) % chunkSize;
      const lz = (i / layer) | 0;
      const x = baseX + lx;
      const y = baseY + ly;
      const z = baseZ + lz;
      if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) continue;
      const linear = x + NX * (y + NY * z);
      const base = i * 3;
      fn({
        x, y, z,
        linearIndex: linear,
        count: cnt,
        r: colorsArr[base + 0] / cnt,
        g: colorsArr[base + 1] / cnt,
        b: colorsArr[base + 2] / cnt,
        alpha: alphasArr ? (alphasArr[i] / cnt) : 1
      });
    }
  }
}

class ChunkedIntGrid {
  constructor(gridSize, chunkSize = VOX_CHUNK_SIZE) {
    this.size = gridSize;
    this.nx = gridSize.x | 0;
    this.ny = gridSize.y | 0;
    this.nz = gridSize.z | 0;
    this.chunkSize = chunkSize;
    this.chunkCountX = Math.max(1, Math.ceil(this.nx / chunkSize));
    this.chunkCountY = Math.max(1, Math.ceil(this.ny / chunkSize));
    this.chunkCountZ = Math.max(1, Math.ceil(this.nz / chunkSize));
    this.layerSize = chunkSize * chunkSize;
    this.chunkVolume = chunkSize * chunkSize * chunkSize;
    this.chunks = new Map();
  }

  _key(cx, cy, cz) {
    return cx + this.chunkCountX * (cy + this.chunkCountY * cz);
  }

  _locate(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return null;
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    const lx = x - cx * this.chunkSize;
    const ly = y - cy * this.chunkSize;
    const lz = z - cz * this.chunkSize;
    const idx = lx + this.chunkSize * (ly + this.chunkSize * lz);
    return { key: this._key(cx, cy, cz), cx, cy, cz, idx };
  }

  _ensureChunk(loc) {
    let chunk = this.chunks.get(loc.key);
    if (!chunk) {
      chunk = { cx: loc.cx, cy: loc.cy, cz: loc.cz, data: new Int32Array(this.chunkVolume) };
      chunk.data.fill(-1);
      this.chunks.set(loc.key, chunk);
    }
    return chunk;
  }

  set(x, y, z, value) {
    const loc = this._locate(x, y, z);
    if (!loc) return;
    const chunk = this._ensureChunk(loc);
    chunk.data[loc.idx] = value;
  }

  get(x, y, z) {
    const loc = this._locate(x, y, z);
    if (!loc) return -1;
    const chunk = this.chunks.get(loc.key);
    if (!chunk) return -1;
    return chunk.data[loc.idx];
  }

    copyToDense(target) {
    for (const chunk of this.chunks.values()) {
      const baseX = chunk.cx * this.chunkSize;
      const baseY = chunk.cy * this.chunkSize;
      const baseZ = chunk.cz * this.chunkSize;
      const data = chunk.data;
      for (let i = 0; i < this.chunkVolume; i++) {
        const val = data[i];
        if (val < 0) continue;
        const lx = i % this.chunkSize;
        const ly = ((i / this.chunkSize) | 0) % this.chunkSize;
        const lz = (i / this.layerSize) | 0;
        const x = baseX + lx;
        const y = baseY + ly;
        const z = baseZ + lz;
        if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) continue;
        const idx = x + this.nx * (y + this.ny * z);
        target[idx] = val;
      }
    }
    }

    forEachFilled(cb) {
      if (typeof cb !== 'function') return;
      for (const chunk of this.chunks.values()) {
        const baseX = chunk.cx * this.chunkSize;
        const baseY = chunk.cy * this.chunkSize;
        const baseZ = chunk.cz * this.chunkSize;
        const data = chunk.data;
        for (let i = 0; i < this.chunkVolume; i++) {
          const val = data[i];
          if (val < 0) continue;
          const lx = i % this.chunkSize;
          const ly = ((i / this.chunkSize) | 0) % this.chunkSize;
          const lz = (i / this.layerSize) | 0;
          const x = baseX + lx;
          const y = baseY + ly;
          const z = baseZ + lz;
          if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) continue;
          cb(x, y, z, val);
        }
      }
    }
  }

  class BlockIndexGrid {
    constructor(gridSize, preferDense = true) {
      this.size = gridSize;
      this.nx = gridSize.x | 0;
      this.ny = gridSize.y | 0;
      this.nz = gridSize.z | 0;
      this.total = Math.max(0, this.nx * this.ny * this.nz);
      this.minX = this.nx;
      this.minY = this.ny;
      this.minZ = this.nz;
      this.maxX = -1;
      this.maxY = -1;
      this.maxZ = -1;
      this.useDense = !!preferDense && this.total <= MAX_DENSE_BLOCK_GRID;
      if (this.useDense) {
        this.data = new Int32Array(this.total);
        this.data.fill(-1);
      } else {
        this.chunked = new ChunkedIntGrid(gridSize, VOX_CHUNK_SIZE);
      }
    }

  _index(x, y, z) {
    return x + this.nx * (y + this.ny * z);
  }

  _decode(idx) {
    if (idx < 0 || idx >= this.total) return null;
    const x = idx % this.nx;
    const y = ((idx / this.nx) | 0) % this.ny;
    const z = (idx / (this.nx * this.ny)) | 0;
    return { x, y, z };
  }

    _markFilled(x, y, z) {
      if (x < this.minX) this.minX = x;
      if (y < this.minY) this.minY = y;
      if (z < this.minZ) this.minZ = z;
      if (x > this.maxX) this.maxX = x;
      if (y > this.maxY) this.maxY = y;
      if (z > this.maxZ) this.maxZ = z;
    }

    setXYZ(x, y, z, value) {
      if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return;
      if (value >= 0) this._markFilled(x, y, z);
      if (this.useDense) this.data[this._index(x, y, z)] = value;
      else this.chunked.set(x, y, z, value);
    }

    setLinear(idx, value) {
      if (idx < 0 || idx >= this.total) return;
      const coords = this._decode(idx);
      if (!coords) return;
      this.setXYZ(coords.x, coords.y, coords.z, value);
    }

  get(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return -1;
    if (this.useDense) return this.data[this._index(x, y, z)];
    return this.chunked.get(x, y, z);
  }

  getLinear(idx) {
    if (this.useDense) {
      if (idx < 0 || idx >= this.data.length) return -1;
      return this.data[idx];
    }
    const coords = this._decode(idx);
    if (!coords) return -1;
    return this.chunked.get(coords.x, coords.y, coords.z);
  }

    toDense() {
      if (this.useDense) return this.data;
      const dense = new Int32Array(this.total);
      dense.fill(-1);
      this.chunked.copyToDense(dense);
      return dense;
    }

    forEachFilled(cb) {
      if (typeof cb !== 'function') return;
      if (this.useDense) {
        const data = this.data;
        const NX = this.nx;
        const NY = this.ny;
        const nzStride = NX * NY;
        for (let idx = 0; idx < data.length; idx++) {
          const val = data[idx];
          if (val < 0) continue;
          const x = idx % NX;
          const y = ((idx / NX) | 0) % NY;
          const z = (idx / nzStride) | 0;
          cb(x, y, z, val);
        }
      } else if (this.chunked) {
        this.chunked.forEachFilled(cb);
      }
    }

    getBounds() {
      if (this.maxX < this.minX || this.maxY < this.minY || this.maxZ < this.minZ) return null;
      const min = { x: this.minX, y: this.minY, z: this.minZ };
      const max = { x: this.maxX, y: this.maxY, z: this.maxZ };
      const size = {
        x: (max.x - min.x + 1) || 1,
        y: (max.y - min.y + 1) || 1,
        z: (max.z - min.z + 1) || 1,
      };
      return { min, max, size };
    }
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
export async function assignVoxelsToBlocks(glbDisplay, voxelGridOverride = null) {
  if (!kdTree) {
    await initBlockData();
    if (!kdTree) return;
  }
  const voxelGrid =
    voxelGridOverride ||
    glbDisplay?._voxelGrid ||
    glbDisplay?._voxelGridRebased ||
    null;
  if (!voxelGrid) { console.error('No voxel grid. Run voxelize() first.'); return; }

  const { gridSize, unit, bbox } = voxelGrid;
  const SX = gridSize.x|0, SY = gridSize.y|0, SZ = gridSize.z|0;

  // 1) Build a dense block-index grid once (KD search per voxel, with the fast 5-6-5 cache)
  const idxGrid = computeBlockIndexGrid(voxelGrid); // Int32Array; -1 = empty/transparent

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

  const neighborDiffers = (x,y,z,bIdx) => idxGrid.get(x,y,z) !== bIdx;

  // 2) PASS 1 — exact neighbor culling with the index grid; count faces per block
  const facesPerBlock = new Uint32Array(BLOCKS.length);

  iterateVoxelSamples(voxelGrid, ({ x, y, z, alpha = 1, linearIndex }) => {
    if (alpha < 0.1) return;
    const bIdx = idxGrid.getLinear(linearIndex);
    if (bIdx < 0) return;

    if (z+1 >= SZ || neighborDiffers(x, y, z+1, bIdx)) facesPerBlock[bIdx]++;
    if (z-1 <  0  || neighborDiffers(x, y, z-1, bIdx)) facesPerBlock[bIdx]++;
    if (x+1 >= SX || neighborDiffers(x+1, y, z, bIdx)) facesPerBlock[bIdx]++;
    if (x-1 <  0  || neighborDiffers(x-1, y, z, bIdx)) facesPerBlock[bIdx]++;
    if (y+1 >= SY || neighborDiffers(x, y+1, z, bIdx)) facesPerBlock[bIdx]++;
    if (y-1 <  0  || neighborDiffers(x, y-1, z, bIdx)) facesPerBlock[bIdx]++;
  });

  // 3) Allocate typed arrays exactly once per block
  const groups = new Array(BLOCKS.length);
  for (let b = 0; b < BLOCKS.length; b++) {
    const f = facesPerBlock[b] | 0;
    if (!f) continue;
    const vCount = f * 4;
    const iCount = f * 6;
    const IndexArray = (vCount > 65535) ? Uint32Array : Uint16Array;
    groups[b] = {
      pos: new Float32Array(vCount * 3),
      uvs: new Float32Array(vCount * 2),
      idx: new IndexArray(iCount),
      vptr: 0, uptr: 0, iptr: 0, vtx: 0
    };
  }

  // 4) PASS 2 — fill geometry
  iterateVoxelSamples(voxelGrid, ({ x, y, z, alpha = 1, linearIndex }) => {
    if (alpha < 0.1) return;
    const bIdx = idxGrid.getLinear(linearIndex);
    if (bIdx < 0) return;
    const grp = groups[bIdx];
    if (!grp) return;

    const cx = bbox.min.x + (x + 0.5) * unit.x;
    const cy = bbox.min.y + (y + 0.5) * unit.y;
    const cz = bbox.min.z + (z + 0.5) * unit.z;

    if (z+1 >= SZ || neighborDiffers(x, y, z+1, bIdx)) emitFace(grp, faceDefs[0], cx, cy, cz);
    if (z-1 <  0  || neighborDiffers(x, y, z-1, bIdx)) emitFace(grp, faceDefs[1], cx, cy, cz);
    if (x+1 >= SX || neighborDiffers(x+1, y, z, bIdx)) emitFace(grp, faceDefs[2], cx, cy, cz);
    if (x-1 <  0  || neighborDiffers(x-1, y, z, bIdx)) emitFace(grp, faceDefs[3], cx, cy, cz);
    if (y+1 >= SY || neighborDiffers(x, y+1, z, bIdx)) emitFace(grp, faceDefs[4], cx, cy, cz);
    if (y-1 <  0  || neighborDiffers(x, y-1, z, bIdx)) emitFace(grp, faceDefs[5], cx, cy, cz);
  });

  function emitFace(grp, face, cx, cy, cz){
    const { pos, uvs, idx } = grp;
    const vbase = grp.vtx;
    // positions (4 verts)
    for (let v = 0; v < 4; v++) {
      const p = face.verts[v];
      pos[grp.vptr++] = cx + p[0]*unit.x;
      pos[grp.vptr++] = cy + p[1]*unit.y;
      pos[grp.vptr++] = cz + p[2]*unit.z;
    }
    // uvs (baked 0..1 face, material does offset/repeat)
    uvs[grp.uptr++] = 0; uvs[grp.uptr++] = 0;
    uvs[grp.uptr++] = 1; uvs[grp.uptr++] = 0;
    uvs[grp.uptr++] = 1; uvs[grp.uptr++] = 1;
    uvs[grp.uptr++] = 0; uvs[grp.uptr++] = 1;
    // indices
    idx[grp.iptr++] = vbase;     idx[grp.iptr++] = vbase+1; idx[grp.iptr++] = vbase+2;
    idx[grp.iptr++] = vbase;     idx[grp.iptr++] = vbase+2; idx[grp.iptr++] = vbase+3;
    grp.vtx += 4;
  }












          // We don’t know neighbor’s block without re‑query. Use heuristic: if its color is very close to ours,
          // we’ll likely map to the same block. This avoids a second k‑d lookup per neighbor.




  // Build final group with one mesh per block (all sampling the shared atlas)
  const voxelGroup = new THREE.Group();
  voxelGroup.name = 'voxelGroup';

  const sharedAtlas = await getSharedAtlasTexture();

  for (let bIdx = 0; bIdx < groups.length; bIdx++) {
    const g = groups[bIdx];
    if (!g) continue;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geom.setAttribute('uv',       new THREE.Float32BufferAttribute(g.uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(g.idx, 1));
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

export async function buildExportGroupFromVoxelGrid(voxelGrid) {
  if (!voxelGrid) throw new Error('buildExportGroupFromVoxelGrid: voxelGrid required');
  await initBlockData();
  const root = new THREE.Group();
  root.name = 'MinecraftExportRoot';
  const baked = await assignVoxelsToBlocks(root, voxelGrid);
  const exportGroup = baked || root.getObjectByName('voxelGroup');
  if (exportGroup && exportGroup.parent) exportGroup.parent.remove(exportGroup);
  return exportGroup || root;
}

export { BLOCKS };

/* ------------------------------------------------------------------ */
/* In-place atlas application (UV baking, no shader patch)             */
/* ------------------------------------------------------------------ */

// Basic atlas material that maps per-voxel tiling from world position (stable across greedy faces)
function makeAtlasBasicMaterial(sharedAtlas) {
  const mat = new THREE.MeshBasicMaterial({ map: sharedAtlas });
  if ('colorSpace' in sharedAtlas) sharedAtlas.colorSpace = THREE.SRGBColorSpace;
  mat.extensions = { derivatives: true };
  mat.onBeforeCompile = (shader) => {
    // uniforms for world-pos tiling and atlas size
    shader.uniforms.uGridMin   = { value: new THREE.Vector3(0,0,0) };
    shader.uniforms.uVoxelSize = { value: 1.0 };
    shader.uniforms.uAtlasSize = { value: new THREE.Vector2(1,1) };

    shader.vertexShader = shader.vertexShader
      .replace('#include <uv_pars_vertex>', `
        #include <uv_pars_vertex>
        attribute vec4 atlasRect;       // (offX, offY, repX, repY) - custom attribute (avoid uv2 vec2 collision)
        attribute vec2 tileBase;        // integer base cell (U0, V0) for the greedy face
        varying   vec4 vRect;
  varying   vec2 vTileBase;
        varying   vec3 vWorldPos;`)
      .replace('#include <uv_vertex>', `
        #include <uv_vertex>
        vRect     = atlasRect;
  // pass per-face base (same for the whole triangle)
  vTileBase = tileBase;
  vWorldPos = (modelMatrix * vec4(position,1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <uv_pars_fragment>', `
        #include <uv_pars_fragment>
        varying vec4 vRect;
        varying vec3 vWorldPos;
        varying vec2 vTileBase;
        uniform vec3  uGridMin;
        uniform float uVoxelSize;
        uniform vec2  uAtlasSize;`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          // Stable face axis via world pos derivatives
          vec3 nrm = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos))); 
          vec3 an  = abs(nrm);
          int axis = 0;
          if (an.y > an.x && an.y >= an.z) axis = 1; else if (an.z > an.x && an.z >= an.y) axis = 2;

          // World -> voxel coordinates (1 unit per voxel)
          vec3 vox = (vWorldPos - uGridMin) / uVoxelSize;

          // Choose plane and flip U for back faces
          vec2 uvGrid;
          if (axis == 0) { uvGrid = vec2(vox.z, vox.y); if (nrm.x < 0.0) uvGrid.x = 1.0 - uvGrid.x; }
          else if (axis == 1){ uvGrid = vec2(vox.x, vox.z); if (nrm.y < 0.0) uvGrid.x = 1.0 - uvGrid.x; }
          else               { uvGrid = vec2(vox.x, vox.y); if (nrm.z < 0.0) uvGrid.x = 1.0 - uvGrid.x; }

          // Make modulo local to the greedy face using the constant base cell
          vec2 local  = uvGrid - vTileBase;
          vec2 fracUV = fract(local + 1e-5); // keep in [0,1)
          // Tiny clamp to avoid sampling outside due to precision
          fracUV = clamp(fracUV, vec2(0.0), vec2(1.0 - 1.0/256.0));

          // Sample centers of the 16x16 sub-rect
          vec2 px = floor(fracUV * 16.0) + 0.5;   // 0.5..15.5
          vec2 atlasUV = vRect.xy + (px / 16.0) * vRect.zw;

          vec4 texelColor = texture2D(map, atlasUV);
          diffuseColor *= texelColor;
        #endif`);

    // expose shader for later uniform updates; set atlas size if known
    mat.userData._shader = shader;
    const img = sharedAtlas.image;
    if (img && img.width && img.height) shader.uniforms.uAtlasSize.value.set(img.width, img.height);

    // If caller attached pending grid info before compile, apply it now
    if (mat.userData.__gridMin) shader.uniforms.uGridMin.value.copy(mat.userData.__gridMin);
    if (typeof mat.userData.__voxelSize === 'number') shader.uniforms.uVoxelSize.value = mat.userData.__voxelSize;
  };
  // Crisp defaults for pixel-art
  mat.toneMapped = false;
  mat.transparent = false;
  mat.depthTest = true;
  mat.depthWrite = true;
  return mat;
}

// Quantized color cache for per-voxel block indexing
function computeBlockIndexGrid(voxelGrid) {
  const { gridSize } = voxelGrid;
  const preferDense = !!(voxelGrid.voxelColors && voxelGrid.voxelCounts);
  const out = new BlockIndexGrid(gridSize, preferDense);
  const LOOK = { r:32, g:64, b:32 };
  const cache = new Int32Array(LOOK.r*LOOK.g*LOOK.b); cache.fill(-1);
  const keyFor = (r,g,b)=>{
    const R=Math.min(LOOK.r-1, Math.max(0,(r*LOOK.r)|0));
    const G=Math.min(LOOK.g-1, Math.max(0,(g*LOOK.g)|0));
    const B=Math.min(LOOK.b-1, Math.max(0,(b*LOOK.b)|0));
    return R + LOOK.r*(G + LOOK.g*B);
  };
  const findNearest=(r,g,b)=>{ const k=keyFor(r,g,b); const c=cache[k]; if(c>=0) return c; const q=applyBrightnessBias(rgbToOKLab(r,g,b)); const best=nearestNeighbor(kdTree,q.L,q.a,q.b,{d2:Infinity,idx:-1}); cache[k]=best.idx; return best.idx; };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
    iterateVoxelSamples(voxelGrid, ({ x, y, z, linearIndex, r, g, b }) => {
      const rr = clamp01(toUnit(r));
      const gg = clamp01(toUnit(g));
      const bb = clamp01(toUnit(b));
      out.setXYZ(x, y, z, findNearest(rr,gg,bb));
    });
    return out;
  }

// Optional fallback triangle picker (if voxelGrid missing) using existing vertex colors
function makeColorFallbackPicker(querySpace='srgb') {
  return (i0,i1,i2, geom) => {
    const col = geom.getAttribute('color');
    if (!col) return -1;
    const arr = col.array;
    const isU8 = (arr instanceof Uint8Array) || (arr instanceof Uint8ClampedArray);
    const s = isU8 ? 255 : 1;
    const r=(col.getX(i0)+col.getX(i1)+col.getX(i2))/(3*s);
    const g=(col.getY(i0)+col.getY(i1)+col.getY(i2))/(3*s);
    const b=(col.getZ(i0)+col.getZ(i1)+col.getZ(i2))/(3*s);
    const q = applyBrightnessBias(rgbToOKLab(r,g,b));
    const best = nearestNeighbor(kdTree, q.L, q.a, q.b, { d2:Infinity, idx:-1 });
    return best.idx;
  };
}

// Bake atlas UVs into geometry's existing uv attribute.
// If MC_TILING_PER_BLOCK is true, each voxel-sized step across a merged greedy face
// increases the underlying block texture UV by +1 (so the 16x16 MC texture repeats).
// When false we preserve prior behavior (stretch over merged quad).
let MC_TILING_PER_BLOCK = true; // expose tweak via window later if needed
export function setMinecraftPerBlockTiling(on){ MC_TILING_PER_BLOCK = !!on; }
export function getMinecraftPerBlockTiling(){ return MC_TILING_PER_BLOCK; }

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

  // Prepare atlasRect (offsetX, offsetY, repeatX, repeatY) per vertex for shader mapping
  let rectAttr = geom.getAttribute('atlasRect');
  if (!rectAttr) {
    rectAttr = new THREE.BufferAttribute(new Float32Array(pos.count * 4), 4);
    geom.setAttribute('atlasRect', rectAttr);
  }
  // Prepare tileBase (U0, V0) per vertex (constant per greedy face)
  let baseAttr = geom.getAttribute('tileBase');
  if (!baseAttr) {
    baseAttr = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geom.setAttribute('tileBase', baseAttr);
  }

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
    if (!voxelGrid) return null;
    tmp.copy(p).addScaledVector(normal, -eps);
    const lx=(tmp.x-bbMin.x)*invUnit.x;
    const ly=(tmp.y-bbMin.y)*invUnit.y;
    const lz=(tmp.z-bbMin.z)*invUnit.z;
    const xi=Math.floor(lx), yi=Math.floor(ly), zi=Math.floor(lz);
    if (xi<0||yi<0||zi<0||xi>=gSize.x||yi>=gSize.y||zi>=gSize.z) return null;
    return { index: xi + gSize.x*(yi + gSize.y*zi), x: xi, y: yi, z: zi };
  }

  function writeTileSpaceUV(vi, axis, sign, p, baseCell) {
    // world -> voxel continuous coords
    const fx = (p.x - bbMin.x) * invUnit.x;
    const fy = (p.y - bbMin.y) * invUnit.y;
    const fz = (p.z - bbMin.z) * invUnit.z;

    let U, V;
    if (axis === 0) {           // X-face -> (Z,Y)
      U = (sign > 0) ?  (fz - baseCell.z) : -(fz - baseCell.z);
      V =                 (fy - baseCell.y);
    } else if (axis === 1) {    // Y-face -> (X,Z)
      U =                 (fx - baseCell.x);
      V = (sign > 0) ?  (fz - baseCell.z) : -(fz - baseCell.z);
    } else {                    // Z-face -> (X,Y)
      U = (sign > 0) ?  (fx - baseCell.x) : -(fx - baseCell.x);
      V =                 (fy - baseCell.y);
    }
    uv.setXY(vi, U, V); // tile-space; can exceed 1 across greedy faces
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
      if (cell) blockIdx = blockIdxGrid.getLinear(cell.index);
    } else if (pickBlockForTriangle) {
      blockIdx = pickBlockForTriangle(i0,i1,i2, geom);
    }
    if (blockIdx < 0) continue;
  const rect = BLOCKS[blockIdx].uv;

  const p0 = new THREE.Vector3().fromBufferAttribute(pos,i0);
    const p1 = new THREE.Vector3().fromBufferAttribute(pos,i1);
    const p2 = new THREE.Vector3().fromBufferAttribute(pos,i2);
    const cellI = { x:0, y:0, z:0 };
    const baseCell = { x:0, y:0, z:0 };
    const span = { x:1, y:1, z:1 };
    if (voxelGrid) {
      // Determine bounding voxel-aligned rectangle for this face by projecting tri verts
      const lx0=(p0.x-bbMin.x)*invUnit.x, ly0=(p0.y-bbMin.y)*invUnit.y, lz0=(p0.z-bbMin.z)*invUnit.z;
      const lx1=(p1.x-bbMin.x)*invUnit.x, ly1=(p1.y-bbMin.y)*invUnit.y, lz1=(p1.z-bbMin.z)*invUnit.z;
      const lx2=(p2.x-bbMin.x)*invUnit.x, ly2=(p2.y-bbMin.y)*invUnit.y, lz2=(p2.z-bbMin.z)*invUnit.z;
      const minX = Math.min(lx0,lx1,lx2), maxX = Math.max(lx0,lx1,lx2);
      const minY = Math.min(ly0,ly1,ly2), maxY = Math.max(ly0,ly1,ly2);
      const minZ = Math.min(lz0,lz1,lz2), maxZ = Math.max(lz0,lz1,lz2);
  // add tiny epsilon to avoid off-by-one at exact integer boundaries
  baseCell.x = Math.floor(minX + 1e-6); baseCell.y = Math.floor(minY + 1e-6); baseCell.z = Math.floor(minZ + 1e-6);
  span.x = Math.max(1, Math.ceil(maxX - 1e-6) - baseCell.x);
  span.y = Math.max(1, Math.ceil(maxY - 1e-6) - baseCell.y);
  span.z = Math.max(1, Math.ceil(maxZ - 1e-6) - baseCell.z);
      // legacy single voxel reference (first vertex) for neighbor queries
      cellI.x = Math.floor(lx0); cellI.y = Math.floor(ly0); cellI.z = Math.floor(lz0);
    }
    // write tile-space UVs
    writeTileSpaceUV(i0, axis, sign, p0, baseCell);
    writeTileSpaceUV(i1, axis, sign, p1, baseCell);
    writeTileSpaceUV(i2, axis, sign, p2, baseCell);
    // map 3D baseCell to the face's 2D plane to get integer (U0,V0)
    let baseU = 0.0, baseV = 0.0;
    if (axis === 0) { baseU = baseCell.z; baseV = baseCell.y; }
    else if (axis === 1){ baseU = baseCell.x; baseV = baseCell.z; }
    else               { baseU = baseCell.x; baseV = baseCell.y; }

    // store base per-vertex (same for the triangle)
    baseAttr.setXY(i0, baseU, baseV);
    baseAttr.setXY(i1, baseU, baseV);
    baseAttr.setXY(i2, baseU, baseV);

    // store rect in custom atlasRect attribute for shader mapping
    rectAttr.setXYZW(i0, rect.offsetX, rect.offsetY, rect.repeatX, rect.repeatY);
    rectAttr.setXYZW(i1, rect.offsetX, rect.offsetY, rect.repeatX, rect.repeatY);
    rectAttr.setXYZW(i2, rect.offsetX, rect.offsetY, rect.repeatX, rect.repeatY);
  }
  try { geom.computeBoundingSphere?.(); } catch {}
  geom.attributes.uv.needsUpdate = true;
  if (geom.attributes.atlasRect) geom.attributes.atlasRect.needsUpdate = true;
  if (geom.attributes.tileBase)  geom.attributes.tileBase.needsUpdate = true;
  // Remove any stale uv2 attribute to avoid conflicts with Three's built-in uv2 (vec2)
  if (geom.getAttribute('uv2')) {
    try { geom.deleteAttribute('uv2'); } catch {}
  }
}

export async function applyAtlasToExistingVoxelMesh(voxelMesh, voxelGrid) {
  await initBlockData();
  if (!kdTree || !BLOCKS.length || !voxelMesh) return;
  const blockIdxGrid = (voxelGrid && voxelGrid.gridSize) ? computeBlockIndexGrid(voxelGrid) : null;
  // Compute world-space grid uniforms from the parent container (tilesContainer)
  const parentWorld = (voxelMesh.parent && voxelMesh.parent.matrixWorld)
    ? voxelMesh.parent.matrixWorld
    : new THREE.Matrix4(); // identity fallback
  const gridMinWorld = voxelGrid?.bbox?.min?.clone?.().applyMatrix4(parentWorld) ?? new THREE.Vector3();
  const worldOrigin  = new THREE.Vector3().applyMatrix4(parentWorld);
  const worldX       = new THREE.Vector3(1,0,0).applyMatrix4(parentWorld).sub(worldOrigin).length();
  const voxelSizeWorld = (voxelGrid?.unit?.x ?? 1) * (worldX || 1);

  const atlas = await getSharedAtlasTexture();
  if ('colorSpace' in atlas) atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.needsUpdate = true;
  const baseMat = makeAtlasBasicMaterial(atlas);
  baseMat.userData.__gridMin   = gridMinWorld;
  baseMat.userData.__voxelSize = voxelSizeWorld; // assume cubic voxels
  const allowApply = !!(voxelMesh.userData && voxelMesh.userData.__mcAllowApply);
  voxelMesh.traverse(n => {
    if (!n.isMesh || !n.geometry) return;
    // Ensure geometry is non-indexed so per-triangle attributes (atlasRect/tileBase)
    // don't conflict on shared vertices across the two triangles of a greedy quad.
    if (n.geometry.getIndex()) {
      const oldGeom = n.geometry;
      const nonIdx = oldGeom.toNonIndexed();
      n.geometry = nonIdx;
      try { oldGeom.dispose(); } catch {}
    }
    if (!n.userData.origMat) n.userData.origMat = n.material;
    const picker = blockIdxGrid ? null : makeColorFallbackPicker('srgb');
    bakeAtlasUVsOnGeometry(n.geometry, voxelGrid || null, blockIdxGrid, picker);
    if (allowApply) {
      // Clone per-geometry so attributes are bound at compile time
      const mcMat = baseMat.clone();
      mcMat.onBeforeCompile = baseMat.onBeforeCompile;
  mcMat.userData = { ...baseMat.userData };
  // Keep OES_standard_derivatives on clones across Three versions
  mcMat.extensions = { derivatives: true };
  // Ensure the shared atlas is bound and uploaded in this renderer context
  mcMat.map = atlas;
  if (mcMat.map) mcMat.map.needsUpdate = true;
      n.material = mcMat;
      n.userData.mcMat = mcMat; // allow toggling back without re-bake
      n.material.needsUpdate = true;
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
  voxelMesh.userData.__mcApplied = false;
}

// ── EXPORT HELPERS ─────────────────────────────────────────────
// Build a compact block grid (palette + indexed 3D array) from a voxelGrid.
// Uses the same KD mapping as MC material assignment to ensure WYSIWYG.
export function buildBlockGrid(voxelGrid) {
  if (!voxelGrid) throw new Error('buildBlockGrid: voxelGrid required');
  const idxGrid = computeBlockIndexGrid(voxelGrid);
  const bounds = idxGrid.getBounds();
  const hasData = !!bounds;
  const min = hasData ? bounds.min : { x: 0, y: 0, z: 0 };
  const size = hasData ? bounds.size : { x: 1, y: 1, z: 1 };
  const SX = size.x | 0;
  const SY = size.y | 0;
  const SZ = size.z | 0;
  const total = Math.max(1, SX * SY * SZ);
  const palette = [];
  const remap   = new Map(); // BLOCK index -> palette idx
  const data    = new Int32Array(total);
  data.fill(-1);

  if (hasData) {
    idxGrid.forEachFilled((x, y, z, bIdx) => {
      if (bIdx < 0 || !BLOCKS[bIdx]) return;
      const lx = x - min.x;
      const ly = y - min.y;
      const lz = z - min.z;
      if (lx < 0 || ly < 0 || lz < 0 || lx >= SX || ly >= SY || lz >= SZ) return;
      const lin = lx + SX * (ly + SY * lz);
      let p = remap.get(bIdx);
      if (p === undefined) {
        p = palette.length;
        palette.push(BLOCKS[bIdx].name);
        remap.set(bIdx, p);
      }
      data[lin] = p;
    });
  }
  return {
    size: { x: SX, y: SY, z: SZ },
    offset: { x: min.x, y: min.y, z: min.z },
    data,
    palette
  };
}

// vanilla-friendly: one /setblock per filled cell
export function generateMcfunction(grid, origin = { x: 0, y: 0, z: 0 }) {
  if (!grid) throw new Error('generateMcfunction: grid required');
  const { size: { x: SX, y: SY, z: SZ }, data, palette } = grid;
  const lines = [];
  const at = (x, y, z) => x + SX * (y + SY * z);
  for (let z = 0; z < SZ; z++) {
    for (let y = 0; y < SY; y++) {
      for (let x = 0; x < SX; x++) {
        const p = data[at(x, y, z)];
        if (p >= 0) {
          const name = `minecraft:${palette[p]}`;
          lines.push(`setblock ~${origin.x + x} ~${origin.y + y} ~${origin.z + z} ${name}`);
        }
      }
    }
  }
  return lines.join('\n');
}

// palette+indices JSON (simple, easy to convert to .schem/.schematic with external tools)
export function generatePaletteJSON(grid) {
  if (!grid) throw new Error('generatePaletteJSON: grid required');
  const { size, palette, data } = grid;
  // Compact: RLE rows to keep files small
  const rows = [];
  const SX = size.x, SY = size.y, SZ = size.z;
  const at = (x, y, z) => x + SX * (y + SY * z);
  for (let z = 0; z < SZ; z++) {
    for (let y = 0; y < SY; y++) {
      let runVal = null, runLen = 0, row = [];
      for (let x = 0; x < SX; x++) {
        const v = data[at(x, y, z)];
        if (runVal === v) runLen++;
        else {
          if (runVal !== null) row.push([runVal, runLen]);
          runVal = v; runLen = 1;
        }
      }
      if (runVal !== null) row.push([runVal, runLen]);
      rows.push({ z, y, row });
    }
  }
  return JSON.stringify({ size, palette, rle: rows }, null, 2);
}

// ── REAL EXPORTERS: Structure .nbt, Sponge .schem, Legacy .schematic ─────────

// NBT write compatibility: prefer gzipped writer; fallback to writeUncompressed + browser gzip
async function nbtWriteCompat(payload) {
  // Prefer gzipped writer if available in shim
  if (NBT && typeof NBT.write === 'function') {
    const bytes = await NBT.write(payload);
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }
  if (NBT && typeof NBT.writeUncompressed === 'function') {
    const raw = NBT.writeUncompressed(payload);
    // Try to gzip using browser API
    try {
      if (typeof CompressionStream !== 'undefined') {
        const cs = new CompressionStream('gzip');
        const blob = new Blob([raw]);
        const stream = blob.stream().pipeThrough(cs);
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      }
    } catch {}
    return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  }
  throw new Error('No NBT write()/writeUncompressed() available');
}

// Build sparse blocks from the dense grid returned by buildBlockGrid
function denseToSparse(dense) {
  const { size, data } = dense;
  const { W: SX, H: SY, L: SZ } = getGridMetrics(size, data, 'denseToSparse');
  const blocks = [];
  const at = (x, y, z) => x + SX * (y + SY * z);
  for (let z = 0; z < SZ; z++)
    for (let y = 0; y < SY; y++)
      for (let x = 0; x < SX; x++) {
        const p = data[at(x,y,z)];
        if (p >= 0) blocks.push({ x, y, z, state: p });
      }
  return blocks;
}

const LEGACY_ID_META_FALLBACK = [1, 0];
let legacyIdMapCache = null;
let legacyIdMapPromise = null;

function normalizeLegacyName(name) {
  if (!name) return '';
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

async function ensureLegacyIdMap() {
  if (legacyIdMapCache) return legacyIdMapCache;
  if (!legacyIdMapPromise) {
    legacyIdMapPromise = (async () => {
      try {
        const resp = await fetch('/legacy.json');
        if (!resp?.ok) throw new Error(`HTTP ${resp?.status} ${resp?.statusText}`);
        const legacyJson = await resp.json();
        const map = {};
        const entries = Object.entries(legacyJson?.blocks || {});
        for (const [key, value] of entries) {
          if (typeof value !== 'string') continue;
          const [idPart, metaPart] = key.split(':');
          const id = Number.parseInt(idPart, 10);
          const meta = Number.parseInt(metaPart, 10);
          if (!Number.isInteger(id) || !Number.isInteger(meta)) continue;
          const name = normalizeLegacyName(value);
          if (!name || map[name]) continue; // prefer first mapping encountered
          map[name] = [id & 255, meta & 15];
        }
        legacyIdMapCache = map;
      } catch (err) {
        console.warn('writeMCEditSchematic: failed to load legacy palette', err);
        legacyIdMapCache = {};
      }
      return legacyIdMapCache;
    })();
  }
  await legacyIdMapPromise;
  return legacyIdMapCache;
}

function legacyIdMetaForName(name, map) {
  const normalized = normalizeLegacyName(name);
  return (map && map[normalized]) || LEGACY_ID_META_FALLBACK;
}

const LEGACY_SCHEM_AXIS_MAX = 0x7fff; // legacy .schematic stores shorts (signed 16-bit)

function getGridMetrics(size, data, ctx = 'grid') {
  if (!size) throw new Error(`${ctx}: missing grid size`);
  const W = size.x | 0;
  const H = size.y | 0;
  const L = size.z | 0;
  if (W <= 0 || H <= 0 || L <= 0) {
    throw new Error(`${ctx}: invalid grid dimensions (${W}x${H}x${L})`);
  }
  const total = W * H * L;
  if (!Number.isSafeInteger(total)) {
    throw new Error(`${ctx}: grid too large (${W}x${H}x${L}) – reduce resolution or export a chunked grid`);
  }
  if (!data) {
    throw new Error(`${ctx}: dense grid missing data`);
  }
  if (data.length !== total) {
    throw new Error(`${ctx}: dense grid data mismatch (expected ${total}, got ${data.length})`);
  }
  return { W, H, L, total };
}

function encodeVarIntBlockData(metrics, data, paletteIds) {
  const { W, H, L, total } = metrics;
  const chunkBytes = Math.min(BLOCKDATA_CHUNK_BYTES, Math.max(1024, total + 16));
  let chunk = new Uint8Array(chunkBytes);
  let offset = 0;
  const chunks = [];
  let totalBytes = 0;

  const pushChunk = (view) => {
    chunks.push(view);
    totalBytes += view.length;
  };

  const writeByte = (byte) => {
    if (offset >= chunk.length) {
      pushChunk(chunk);
      chunk = new Uint8Array(chunkBytes);
      offset = 0;
    }
    chunk[offset++] = byte;
  };

  const writeVarInt = (value) => {
    let v = value >>> 0;
    do {
      let b = v & 0x7F;
      v >>>= 7;
      if (v !== 0) b |= 0x80;
      writeByte(b);
    } while (v !== 0);
  };

  const at = (x, y, z) => x + W * (y + H * z);
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < L; z++) {
      for (let x = 0; x < W; x++) {
        const p = data[at(x, y, z)];
        const id = (p >= 0 && p < paletteIds.length) ? paletteIds[p] : 0;
        writeVarInt(id);
      }
    }
  }

  if (offset > 0) {
    pushChunk(chunk.subarray(0, offset));
  }

  const BlockData = new Uint8Array(totalBytes);
  let cursor = 0;
  for (const view of chunks) {
    BlockData.set(view, cursor);
    cursor += view.length;
  }
  return BlockData;
}

// Java Structure Block .nbt (gzipped NBT)
export async function writeStructureNBT(denseGrid, { dataVersion = 3955 } = {}) {
  if (!denseGrid) throw new Error('writeStructureNBT: grid required');
  const { size, palette } = denseGrid;
  getGridMetrics(size, denseGrid.data, 'writeStructureNBT');
  const paletteNames = Array.isArray(palette) ? palette : [];
  const blocks = denseToSparse(denseGrid);
  const fullNames = paletteNames.map(n => `minecraft:${n}`);

  const nbtRoot = {
    DataVersion: { type: 'int', value: dataVersion },
    size:       { type: 'list', value: { type: 'int', value: [size.x|0, size.y|0, size.z|0] } },
    palette: {
      type: 'list',
      value: { type: 'compound', value: fullNames.map(name => ({ Name: { type:'string', value: name } })) }
    },
    blocks: {
      type: 'list',
      value: { type: 'compound', value: blocks.map(b => ({
        pos:   { type:'list', value: { type:'int', value:[b.x|0, b.y|0, b.z|0] } },
        state: { type:'int',   value:b.state|0 },
      })) }
    },
    entities: { type: 'list', value: { type: 'compound', value: [] } }
  };

  const payload = { type: 'compound', name: '', value: nbtRoot };
  return await nbtWriteCompat(payload);
}

// Sponge WorldEdit .schem (v2) – dependency-free writer using prismarine-nbt
export async function writeSpongeSchem(denseGrid, { dataVersion = 3955 } = {}) {
  if (!denseGrid) throw new Error('writeSpongeSchem: grid required');
  const { size, palette, data } = denseGrid;
  const paletteNames = Array.isArray(palette) ? palette : [];
  const metrics = getGridMetrics(size, data, 'writeSpongeSchem');
  const { W, H, L } = metrics;

  // Build string->int palette; include air
  const pal = { 'minecraft:air': 0 };
  let next = 1;
  const paletteIds = new Int32Array(paletteNames.length);
  for (let i = 0; i < paletteNames.length; i++) {
    const name = paletteNames[i];
    const full = `minecraft:${name}`;
    if (!(full in pal)) pal[full] = next++;
    paletteIds[i] = pal[full];
  }
  const paletteMax = next;

  const BlockData = encodeVarIntBlockData(metrics, data, paletteIds);

  const root = {
    Version:     { type:'int', value: 2 },
    DataVersion: { type:'int', value: dataVersion },
    Width:       { type:'short', value: W },
    Height:      { type:'short', value: H },
    Length:      { type:'short', value: L },
    PaletteMax:  { type:'int', value: paletteMax },
    Palette:     {
      type:'compound',
      value: Object.fromEntries(Object.entries(pal).map(([k,v]) => [k, {type:'int', value:v}]))
    },
    BlockData:   { type:'byte[]', value: BlockData },
    Offset:      { type:'int[]', value: [0,0,0] }
  };

  const payload = { type:'compound', name:'Schematic', value: root };
  return await nbtWriteCompat(payload);
}

// Legacy MCEdit .schematic (gzipped NBT)
export async function writeMCEditSchematic(denseGrid) {
  if (!denseGrid) throw new Error('writeMCEditSchematic: grid required');
  const { size, palette, data } = denseGrid;
  const paletteNames = Array.isArray(palette) ? palette : [];
  const legacyMap = await ensureLegacyIdMap();
  const metrics = getGridMetrics(size, data, 'writeMCEditSchematic');
  const { W, H, L, total } = metrics;

  if (W > LEGACY_SCHEM_AXIS_MAX || H > LEGACY_SCHEM_AXIS_MAX || L > LEGACY_SCHEM_AXIS_MAX) {
    throw new Error(`writeMCEditSchematic: ${W}x${H}x${L} exceeds the legacy 32k-per-axis limit. Use .schem or reduce resolution.`);
  }

  let Blocks, DataArray;
  try {
    Blocks = new Uint8Array(total);
    DataArray = new Uint8Array(total);
  } catch (err) {
    throw new Error(`writeMCEditSchematic: failed to allocate ${total.toLocaleString()} voxels (${(total/1e6).toFixed(1)}M). Try .schem export or lower detail. Original error: ${err?.message || err}`);
  }

  // Y-Z-X order for legacy schematic
  const toIndex = (x, y, z) => y * L * W + z * W + x;
  const at = (x, y, z) => x + W * (y + H * z);
  for (let z = 0; z < L; z++)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = data[at(x,y,z)];
        if (p >= 0 && p < paletteNames.length) {
          const name = paletteNames[p];
          const [id, meta] = legacyIdMetaForName(name, legacyMap);
          const idx = toIndex(x,y,z);
          Blocks[idx] = id & 255;
          DataArray[idx] = meta & 15;
        }
      }

  const root = {
    Width:      { type:'short', value: W },
    Height:     { type:'short', value: H },
    Length:     { type:'short', value: L },
    Materials:  { type:'string', value: 'Alpha' },
    Blocks:     { type:'byteArray', value: Blocks },
    Data:       { type:'byteArray', value: DataArray },
    Entities:   { type:'list', value:{ type:'compound', value: [] } },
    TileEntities:{ type:'list', value:{ type:'compound', value: [] } }
  };
  const payload = { type:'compound', name:'', value: root };
  return await nbtWriteCompat(payload);
}
