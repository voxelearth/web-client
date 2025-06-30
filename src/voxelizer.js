/* paletteVoxelizer_fixed.js – fast GPU voxeliser with adaptive palette
 * GPL-3.0 • 2025‑06‑23 (REV‑G7: barycentric bounds check, linear color space)
 */

import * as THREE from 'three';
import { storage, uniform, instanceIndex, wgslFn } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import StorageBufferAttribute from 'three/src/renderers/common/StorageBufferAttribute.js';

/* tiny 32‑bit popcount */
function popcnt32(n) {
  n -= (n >>> 1) & 0x55555555;
  n  = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

/* texture-sampler cache - NOW CORRECTLY CONVERTS sRGB TO LINEAR */
const _samplers = new WeakMap();
function getSampler(tex) {
  if (!tex) return null;
  if (_samplers.has(tex)) return _samplers.get(tex);

  let sampler = null, img = tex.image;
  const build = (arr, w, h) => {
    const { offset: off, repeat: rep, rotation: rot, center: cen, flipY, wrapS, wrapT } = tex;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);

    return (uv, wantRGBA = false) => {
      // UV transform + clamp/wrap
      let u = uv.x * rep.x + off.x, v = uv.y * rep.y + off.y;
      if (rot !== 0) {
        u -= cen.x; v -= cen.y;
        const u2 = u * cosR - v * sinR, v2 = u * sinR + v * cosR;
        u = u2 + cen.x; v = v2 + cen.y;
      }
      u = wrapS === THREE.RepeatWrapping ? ((u % 1) + 1) % 1 : THREE.MathUtils.clamp(u, 0, 1);
      v = wrapT === THREE.RepeatWrapping ? ((v % 1) + 1) % 1 : THREE.MathUtils.clamp(v, 0, 1);
      if (flipY) v = 1 - v;

      // Bilinear against the four surrounding texels
      const x  = u * (w - 1), y  = v * (h - 1);
      const x0 = Math.floor(x), x1 = Math.min(w - 1, x0 + 1);
      const y0 = Math.floor(y), y1 = Math.min(h - 1, y0 + 1);
      const tx = x - x0, ty = y - y0;
      const sample = (ix, iy) => {
        const i = (iy * w + ix) * 4;
        return {
          r: arr[i] / 255, g: arr[i + 1] / 255, b: arr[i + 2] / 255, a: arr[i + 3] / 255
        };
      };
      const c00 = sample(x0, y0), c10 = sample(x1, y0),
            c01 = sample(x0, y1), c11 = sample(x1, y1);
      const lerp = (a, b, t) => a + (b - a) * t;

      const r0 = lerp(c00.r, c10.r, tx), g0 = lerp(c00.g, c10.g, tx), b0 = lerp(c00.b, c10.b, tx),
            r1 = lerp(c01.r, c11.r, tx), g1 = lerp(c01.g, c11.g, tx), b1 = lerp(c01.b, c11.b, tx);

      if (wantRGBA) {
        const a0 = lerp(c00.a, c10.a, tx), a1 = lerp(c01.a, c11.a, tx), a = lerp(a0, a1, ty);
        const rgba = { r: lerp(r0, r1, ty), g: lerp(g0, g1, ty), b: lerp(b0, b1, ty), a };
        // NOTE: Alpha values are not gamma corrected.
        if (tex.encoding === THREE.sRGBEncoding) {
          const tempColor = new THREE.Color(rgba.r, rgba.g, rgba.b).convertSRGBToLinear();
          rgba.r = tempColor.r;
          rgba.g = tempColor.g;
          rgba.b = tempColor.b;
        }
        return rgba;
      }
      
      const color = new THREE.Color(lerp(r0, r1, ty), lerp(g0, g1, ty), lerp(b0, b1, ty));
      // **FIX**: If texture is sRGB, convert to linear space for consistent color math.
      if (tex.encoding === THREE.sRGBEncoding) {
          color.convertSRGBToLinear();
      }
      return color;
    };
  };

  if (img) {
    if (img.data && img.width && img.height) {
      sampler = build(img.data, img.width, img.height);
    } else if (img.width && img.height) {
      const cvs = document.createElement('canvas');
      cvs.width = img.width; cvs.height = img.height;
      const ctx = cvs.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      sampler = build(ctx.getImageData(0, 0, cvs.width, cvs.height).data, cvs.width, cvs.height);
    }
  }

  _samplers.set(tex, sampler);
  return sampler;
}

/* All color-bearing texture slots from the GLTF spec we care about */
const COLOR_MAP_KEYS = ['map', 'emissiveMap'];
function* allTextures(mat) {
  for (const k of COLOR_MAP_KEYS) {
    const t = mat[k];
    if (t && t.isTexture) yield t;
  }
}

/* K‑means palette generation (operates in linear color space) */
function kMeansPalette(colors, k = 64, iters = 8) {
  const n = colors.length / 3;
  if (n === 0) return { palette: new Float32Array(k * 3) }; // Handle empty case
  const cent = new Float32Array(k * 3);
  const idx  = new Uint8Array(n);
  const sel  = new Set();
  while (sel.size < k && sel.size < n) sel.add(Math.floor(Math.random() * n));
  let ci = 0;
  for (const s of sel) {
    cent[ci++] = colors[s*3];
    cent[ci++] = colors[s*3+1];
    cent[ci++] = colors[s*3+2];
  }
  const sums = new Float32Array(k*3), cnts = new Uint32Array(k);
  for (let it = 0; it < iters; ++it) {
    sums.fill(0); cnts.fill(0);
    for (let p = 0; p < n; ++p) {
      const r = colors[p*3], g = colors[p*3+1], b = colors[p*3+2];
      let best=0, bestD=1e9;
      for (let c=0; c<k; ++c) {
        const dr=r-cent[c*3], dg=g-cent[c*3+1], db=b-cent[c*3+2],
              d = dr*dr + dg*dg + db*db;
        if (d < bestD) { bestD = d; best = c; }
      }
      idx[p] = best;
      sums[best*3]   += r;
      sums[best*3+1] += g;
      sums[best*3+2] += b;
      cnts[best]++;
    }
    for (let c=0; c<k; ++c) {
      const ct = Math.max(1, cnts[c]);
      cent[c*3]   = sums[c*3]   / ct;
      cent[c*3+1] = sums[c*3+1] / ct;
      cent[c*3+2] = sums[c*3+2] / ct;
    }
  }
  return { palette: cent };
}

/* ====================================================================== */
export default class PaletteVoxelizer {

  async init({ renderer, model,
               voxelSize=0.01,
               maxGrid=Infinity,
               paletteSize=256 }) {

    this.renderer    = renderer;
    this.voxelSize   = voxelSize;
    this.paletteSize = paletteSize;

    // 1) Bake + merge: positions, uvs, indices, triMats, palette, materials
    const baked = this.#bakeAndMerge(model);
    this.positions = baked.positions;
    this.uvs       = baked.uvs;
    this.indices   = baked.indices;
    this.triMats   = baked.triMats;
    this.palette   = baked.palette;
    this.materials = baked.materials;

    // 2) GPU buffers
    this.posBuf = new StorageBufferAttribute(this.positions, 3);
    this.uvBuf  = new StorageBufferAttribute(this.uvs,       2);
    this.idxBuf = new StorageBufferAttribute(this.indices,    1);
    this.matBuf = new StorageBufferAttribute(this.triMats,    1);

    // 3) Grid dims
    this.bbox = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); this.bbox.getSize(size);
    let nx = Math.ceil(size.x/voxelSize),
        ny = Math.ceil(size.y/voxelSize),
        nz = Math.ceil(size.z/voxelSize);
    const m = Math.max(nx,ny,nz),
          scale = Number.isFinite(maxGrid) && m>maxGrid ? maxGrid/m : 1;
    this.grid = new THREE.Vector3(
      Math.ceil(nx*scale),
      Math.ceil(ny*scale),
      Math.ceil(nz*scale)
    );
    this.voxelSize  /= scale;
    this.voxelCount  = this.grid.x * this.grid.y * this.grid.z;

    // 4) Allocate bit, tri & distance grids
//     const bitWords = Math.ceil(this.voxelCount/32),
//           triWords = this.voxelCount;
//     this.bitGrid  = new StorageBufferAttribute(new Uint32Array(bitWords),1);
//     this.triGrid  = new StorageBufferAttribute(new Uint32Array(triWords),1);
//     const distInit = new Uint32Array(triWords);
//     distInit.fill(0x7f800000); // +Infinity for f32
//     this.distGrid = new StorageBufferAttribute(distInit,1);


 this.bitGrid = this.triGrid = this.distGrid =
   new StorageBufferAttribute(new Uint32Array(0), 1);

    // 5) Clear grids
    const clearWGSL = wgslFn(`
      fn compute(
        bits : ptr<storage, array<atomic<u32>>, read_write>,
        tris : ptr<storage, array<u32>, read_write>,
        dists: ptr<storage, array<atomic<u32>>, read_write>,
        id: u32
      ) -> void {
        if (id < arrayLength(&*bits)) { atomicStore(&bits[id], 0u); }
        if (id < arrayLength(&*tris)) { tris[id] = 0u; }
        if (id < arrayLength(&*dists)) { atomicStore(&dists[id], 0x7f800000u); }
      }`);
//     await renderer.computeAsync(
//       clearWGSL({
//         bits: storage(this.bitGrid, 'atomic<u32>', this.bitGrid.count),
//         tris: storage(this.triGrid, 'u32', this.triGrid.count),
//         dists: storage(this.distGrid, 'atomic<u32>', this.distGrid.count),
//         id: instanceIndex
//       }).compute(Math.max(bitWords,triWords))
//     );

    // 6) Raster kernel – keeps closest triangle per voxel (race‑free)
    const rasterWGSL = wgslFn(/* wgsl */`
fn compute(
  pos  : ptr<storage, array<vec3<f32>>,  read>,
  ind  : ptr<storage, array<u32>,        read>,
  bits : ptr<storage, array<atomic<u32>>, read_write>,
  tris : ptr<storage, array<u32>,         read_write>,
  dists: ptr<storage, array<atomic<u32>>, read_write>,
  gDim : vec3<u32>, bMin : vec3<f32>, vSz : f32, triId : u32
) -> void {
  let i0 = ind[triId*3u];
  let i1 = ind[triId*3u+1u];
  let i2 = ind[triId*3u+2u];

  let v0 = pos[i0];
  let v1 = pos[i1];
  let v2 = pos[i2];

  // triangle AABB in voxel space
  let tMin = min(min(v0,v1), v2);
  let tMax = max(max(v0,v1), v2);
  var vMin = max(vec3<u32>(0u),       vec3<u32>((tMin-bMin)/vSz));
  var vMax = min(gDim-vec3<u32>(1u),  vec3<u32>((tMax-bMin)/vSz));

  let half = vSz*0.5;
  let nx   = gDim.x;
  let ny   = gDim.y;

  let n    = cross(v1-v0, v2-v0);
  let absN = abs(n);
  let nn   = dot(n,n);

  for (var z=vMin.z; z<=vMax.z; z=z+1u) {
    for (var y=vMin.y; y<=vMax.y; y=y+1u) {
      for (var x=vMin.x; x<=vMax.x; x=x+1u) {

        let c   = bMin + (vec3<f32>(f32(x),f32(y),f32(z)) + vec3<f32>(0.5)) * vSz;
        let tv0 = v0 - c;
        let tv1 = v1 - c;
        let tv2 = v2 - c;
        let rP  = half*(absN.x + absN.y + absN.z);
        if (abs(dot(n, tv0)) > rP) { continue; }

          /* 2) edge × axis tests (9 in total) */
          let e0 = tv1 - tv0;
          let e1 = tv2 - tv1;
          let e2 = tv0 - tv2;

          /* macro to run one test inline */
          {
              let axis = cross(e0, vec3<f32>(1.0,0.0,0.0));
              let p0   = dot(axis, tv0);
              let p1   = dot(axis, tv1);
              let p2   = dot(axis, tv2);
              let mn   = min(p0, min(p1, p2));
              let mx   = max(p0, max(p1, p2));
              let r    = half * (abs(axis.y) + abs(axis.z));
              if (mn > r || mx < -r) { continue; }
          }
          {
              let axis = cross(e0, vec3<f32>(0.0,1.0,0.0));
              let p0   = dot(axis, tv0);
              let p1   = dot(axis, tv1);
              let p2   = dot(axis, tv2);
              let mn   = min(p0, min(p1, p2));
              let mx   = max(p0, max(p1, p2));
              let r    = half * (abs(axis.x) + abs(axis.z));
              if (mn > r || mx < -r) { continue; }
          }
          {
              let axis = cross(e0, vec3<f32>(0.0,0.0,1.0));
              let p0   = dot(axis, tv0);
              let p1   = dot(axis, tv1);
              let p2   = dot(axis, tv2);
              let mn   = min(p0, min(p1, p2));
              let mx   = max(p0, max(p1, p2));
              let r    = half * (abs(axis.x) + abs(axis.y));
              if (mn > r || mx < -r) { continue; }
          }

          {
              let axis = cross(e1, vec3<f32>(1.0,0.0,0.0));
              let p0   = dot(axis, tv0);
              let p1   = dot(axis, tv1);
              let p2   = dot(axis, tv2);
              let mn   = min(p0, min(p1, p2));
              let mx   = max(p0, max(p1, p2));
              let r    = half * (abs(axis.y) + abs(axis.z));
              if (mn > r || mx < -r) { continue; }
          }
          {
              let axis = cross(e1, vec3<f32>(0.0,1.0,0.0));
              let p0   = dot(axis, tv0);
              let p1   = dot(axis, tv1);
              let p2   = dot(axis, tv2);
              let mn   = min(p0, min(p1, p2));
              let mx   = max(p0, max(p1, p2));
              let r    = half * (abs(axis.x) + abs(axis.z));
              if (mn > r || mx < -r) { continue; }
          }
          {
              let axis = cross(e1, vec3<f32>(0.0,0.0,1.0));
              let p0   = dot(axis, tv0);
              let p1   = dot(axis, tv1);
              let p2   = dot(axis, tv2);
              let mn   = min(p0, min(p1, p2));
              let mx   = max(p0, max(p1, p2));
              let r    = half * (abs(axis.x) + abs(axis.y));
              if (mn > r || mx < -r) { continue; }
          }

          {
              let axis = cross(e2, vec3<f32>(1.0,0.0,0.0));
              let p0   = dot(axis, tv0);
              let p1   = dot(axis, tv1);
              let p2   = dot(axis, tv2);
              let mn   = min(p0, min(p1, p2));
              let mx   = max(p0, max(p1, p2));
              let r    = half * (abs(axis.y) + abs(axis.z));
              if (mn > r || mx < -r) { continue; }
          }
          {
              let axis = cross(e2, vec3<f32>(0.0,1.0,0.0));
              let p0   = dot(axis, tv0);
              let p1   = dot(axis, tv1);
              let p2   = dot(axis, tv2);
              let mn   = min(p0, min(p1, p2));
              let mx   = max(p0, max(p1, p2));
              let r    = half * (abs(axis.x) + abs(axis.z));
              if (mn > r || mx < -r) { continue; }
          }
          {
              let axis = cross(e2, vec3<f32>(0.0,0.0,1.0));
              let p0   = dot(axis, tv0);
              let p1   = dot(axis, tv1);
              let p2   = dot(axis, tv2);
              let mn   = min(p0, min(p1, p2));
              let mx   = max(p0, max(p1, p2));
              let r    = half * (abs(axis.x) + abs(axis.y));
              if (mn > r || mx < -r) { continue; }
          }


        // voxel index helpers
        let flat = x + y*nx + z*nx*ny;
        let bw   = flat >> 5u;
        let bm   = 1u << (flat & 31u);

        // compute squared dist of voxel centre to triangle plane
        let dist2 = (dot(n, tv0) * dot(n, tv0)) / nn;
        let dBits = bitcast<u32>(dist2);
        let prev  = atomicMin(&dists[flat], dBits);

        // if we are closer than previous, we own this voxel’s colour
        if (dBits < prev) {
          tris[flat] = triId + 1u;
        }
        // mark occupancy regardless (any triangle touching sets bit)
        atomicOr(&bits[bw], bm);
      }
    }
  }
}`); // WGSL


    const triCount = this.indices.length / 3;
//     await renderer.computeAsync(
//       rasterWGSL({
//         pos:   storage(this.posBuf, 'vec3', this.posBuf.count).toReadOnly(),
//         ind:   storage(this.idxBuf, 'u32', this.idxBuf.count).toReadOnly(),
//         bits:  storage(this.bitGrid, 'atomic<u32>', this.bitGrid.count),
//         tris:  storage(this.triGrid, 'u32', this.triGrid.count),
//         dists: storage(this.distGrid, 'atomic<u32>', this.distGrid.count),
//         gDim:  uniform(this.grid),
//         bMin:  uniform(this.bbox.min),
//         vSz:   uniform(this.voxelSize),
//         triId: instanceIndex
//       }).compute(triCount)
//     );

// keep them so the tiled CPU stage can re-use the same pipelines
this._clearWGSL  = clearWGSL;
this._rasterWGSL = rasterWGSL;


    // 7) CPU sample & build instanced mesh with affine UV + palette lookup
    await this.#buildInstancedMesh();
  }




/* ──────────────────────────────── 7) CPU sample → instanced mesh ─────────────────────────────── */
/* ────────────────────── 7) CPU sample → sparse-octree mesh (fixed) ───────────────────── */
/* ─────────────────── 7) tiled GPU raster → sparse-octree mesh ─────────────────── */
/* ───────────── 7) tiled GPU raster → exact-leaf instanced mesh ───────────── */
/* ───────────── 7) tiled GPU raster → exact-leaf instanced mesh (parallel) ───────────── */
async #buildInstancedMesh() {
  // 1) Constants
  const MAX_GPU_BYTES   = 256 * 1024 * 1024;
  const BYTES_PER_VOXEL = 8.2;
  const TILE_EDGE       = Math.floor(Math.cbrt(MAX_GPU_BYTES / BYTES_PER_VOXEL));

  // 2) Scene / pipeline handles
  const { grid, voxelSize: voxSz, bbox } = this;
  const { x: NX, y: NY, z: NZ }          = grid;
  const rend      = this.renderer;
  const clearWGSL = this._clearWGSL;
  const rastWGSL  = this._rasterWGSL;
  const posBuf    = storage(this.posBuf, 'vec3', this.posBuf.count).toReadOnly();
  const idxBuf    = storage(this.idxBuf, 'u32',  this.idxBuf.count).toReadOnly();
  const { positions:posA, uvs:uvA, indices:idxA, triMats, palette, materials:mats } = this;

  // 3) Scratch vectors for color sampling
  const v0=new THREE.Vector3(), v1=new THREE.Vector3(), v2=new THREE.Vector3();
  const uv0=new THREE.Vector2(), uv1=new THREE.Vector2(), uv2=new THREE.Vector2();
  const p = new THREE.Vector3(), e0=new THREE.Vector3(), e1=new THREE.Vector3(), ep=new THREE.Vector3();

  // 4) Gather per-tile promises
  const tileTasks = [];

  for (let oz = 0; oz < NZ; oz += TILE_EDGE) {
    const tz = Math.min(TILE_EDGE, NZ - oz);
    for (let oy = 0; oy < NY; oy += TILE_EDGE) {
      const ty = Math.min(TILE_EDGE, NY - oy);
      for (let ox = 0; ox < NX; ox += TILE_EDGE) {
        const tx = Math.min(TILE_EDGE, NX - ox);
        const tileVox  = tx * ty * tz;
        const bitWords = Math.ceil(tileVox / 32);

        // Allocate fresh small buffers for this tile
        const bitBuf  = new StorageBufferAttribute(new Uint32Array(bitWords), 1);
        const triBuf  = new StorageBufferAttribute(new Uint32Array(tileVox),   1);
        const distArr = new Uint32Array(tileVox); distArr.fill(0x7f800000);
        const distBuf = new StorageBufferAttribute(distArr, 1);

        // 4a) Enqueue clear compute
        rend.computeAsync(
          clearWGSL({
            bits : storage(bitBuf, 'atomic<u32>', bitBuf.count),
            tris : storage(triBuf, 'u32',         triBuf.count),
            dists: storage(distBuf,'atomic<u32>', distBuf.count),
            id   : instanceIndex
          }).compute(Math.max(bitWords, tileVox))
        );

        // 4b) Enqueue raster compute
        const tileMin = new THREE.Vector3(
          bbox.min.x + ox * voxSz,
          bbox.min.y + oy * voxSz,
          bbox.min.z + oz * voxSz
        );
        const gDim = new THREE.Vector3(tx, ty, tz);
        const rasterPromise = rend.computeAsync(
          rastWGSL({
            pos  : posBuf,
            ind  : idxBuf,
            bits : storage(bitBuf, 'atomic<u32>', bitBuf.count),
            tris : storage(triBuf, 'u32',         triBuf.count),
            dists: storage(distBuf,'atomic<u32>', distBuf.count),
            gDim : uniform(gDim),
            bMin : uniform(tileMin),
            vSz  : uniform(voxSz),
            triId: instanceIndex
          }).compute(this.indices.length / 3)
        );

        // 4c) After raster, read back both buffers
        const tileTask = rasterPromise.then(() => Promise.all([
          rend.getArrayBufferAsync(bitBuf),
          rend.getArrayBufferAsync(triBuf)
        ])).then(([bitsBuffer, trisBuffer]) => {
          // Process this tile entirely on the CPU
          const bitsCPU = new Uint32Array(bitsBuffer);
          const trisCPU = new Uint32Array(trisBuffer);
          let flat = 0;

          const localResults = { centers: [], rgba: [] };

          for (let wi = 0; wi < bitsCPU.length; ++wi) {
            let word = bitsCPU[wi];
            if (!word) { flat += 32; continue; }
            for (let b = 0; b < 32 && flat < tileVox; ++b, ++flat) {
              if ((word & 1) === 0) { word >>>= 1; continue; }
              word >>>= 1;

              const raw = trisCPU[flat];
              if (!raw) continue;
              const tId = raw - 1;

              // local→global coords
              const lz = (flat / (tx * ty)) | 0;
              const rem=  flat % (tx * ty);
              const ly = (rem / tx) | 0;
              const lx =  rem % tx;
              const gx = ox + lx, gy = oy + ly, gz = oz + lz;

              // voxel center
              const cx = bbox.min.x + (gx + 0.5) * voxSz;
              const cy = bbox.min.y + (gy + 0.5) * voxSz;
              const cz = bbox.min.z + (gz + 0.5) * voxSz;

              // sample color (same code as before)…
              v0.fromArray(posA, idxA[tId*3+0]*3);
              v1.fromArray(posA, idxA[tId*3+1]*3);
              v2.fromArray(posA, idxA[tId*3+2]*3);

              uv0.fromArray(uvA, idxA[tId*3+0]*2);
              uv1.fromArray(uvA, idxA[tId*3+1]*2);
              uv2.fromArray(uvA, idxA[tId*3+2]*2);

              e0.subVectors(v1, v0);
              e1.subVectors(v2, v0);
              ep.set(cx, cy, cz).sub(v0);

              const d00 = e0.dot(e0), d01 = e0.dot(e1), d11 = e1.dot(e1);
              const d20 = ep.dot(e0), d21 = ep.dot(e1);
              const inv = 1 / (d00*d11 - d01*d01);

              let vv = (d11*d20 - d01*d21) * inv;
              let ww = (d00*d21 - d01*d20) * inv;
              let uu = 1 - vv - ww;
              if (uu<0||vv<0||ww<0) {
                const tri = new THREE.Triangle(v0, v1, v2);
                const cp  = new THREE.Vector3();
                tri.closestPointToPoint(ep.add(v0), cp);
                ep.copy(cp).sub(v0);
                const d20c = ep.dot(e0), d21c = ep.dot(e1);
                vv = (d11*d20c - d01*d21c)*inv;
                ww = (d00*d21c - d01*d20c)*inv;
                uu = 1 - vv - ww;
              }
              const uvp = new THREE.Vector2(
                uu*uv0.x + vv*uv1.x + ww*uv2.x,
                uu*uv0.y + vv*uv1.y + ww*uv2.y
              );

              const mat = mats[triMats[tId]] || mats[0];
              if (!mat) continue;
              let col = mat.color?.clone() ?? new THREE.Color(1,1,1);
              if (mat.emissive && mat.emissive.getHex()) col.add(mat.emissive);
              for (const tex of allTextures(mat)) {
                const s = getSampler(tex);
                if (s) col.multiply(s(uvp));
              }
              let alpha = mat.opacity ?? 1;
              if (mat.alphaMap) {
                const s = getSampler(mat.alphaMap);
                if (s) alpha *= s(uvp, true).a;
              }
              if (alpha < 0.5) continue;

              let best=0, bestD=Infinity;
              for (let c=0; c<this.paletteSize; ++c) {
                const dr = col.r - palette[c*3],
                      dg = col.g - palette[c*3+1],
                      db = col.b - palette[c*3+2],
                      d  = dr*dr + dg*dg + db*db;
                if (d < bestD) { bestD = d; best = c; }
              }

              localResults.centers.push(cx, cy, cz);
              localResults.rgba   .push(
                palette[best*3],
                palette[best*3+1],
                palette[best*3+2]
              );
            }
          }

          return localResults;
        });

        tileTasks.push(tileTask);
      }
    }
  }

  // 5) Await *all* tiles in parallel
  const results = await Promise.all(tileTasks);

  // 6) Flatten into typed arrays
  let total = 0;
  for (const r of results) total += r.centers.length / 3;
  if (total === 0) {
    this.voxelMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial()
    );
    return;
  }

  const centersA = new Float32Array(total * 3),
        colorsA  = new Float32Array(total * 3);

  let offC = 0, offR = 0;
  for (const r of results) {
    centersA.set(r.centers, offC);
    colorsA .set(r.rgba,    offR);
    offC += r.centers.length;
    offR += r.rgba   .length;
  }

  // 7) Build instanced mesh
  const geo  = new THREE.BoxGeometry(voxSz, voxSz, voxSz),
        matM = new THREE.MeshBasicMaterial({ vertexColors: true }),
        inst = new THREE.InstancedMesh(geo, matM, total),
        M4   = new THREE.Matrix4();

  for (let i = 0; i < total; ++i) {
    M4.makeTranslation(
      centersA[i*3+0],
      centersA[i*3+1],
      centersA[i*3+2]
    );
    inst.setMatrixAt(i, M4);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.instanceColor = new THREE.InstancedBufferAttribute(colorsA, 3);
  inst.instanceColor.needsUpdate  = true;
  inst.frustumCulled = false;

  this.voxelMesh = inst;
}





  /* bake+merge → positions, uvs, indices, triMats, palette, materials */
  #bakeAndMerge(root) {
    const geoms = [], indices = [], allRGB = [], triMats = [], uvs = [], materials = [];
    const matMap = new Map();
    let offset = 0;

    root.traverse(o => {
      if (!o.isMesh || !o.geometry.getAttribute('position')) return;
      
      o.updateWorldMatrix(true, false);
      let g = o.geometry.clone().applyMatrix4(o.matrixWorld).toNonIndexed();
      const posA = g.getAttribute('position');
      if (!posA) return;

      const meshMats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of meshMats) {
        if (m && !matMap.has(m)) {
          matMap.set(m, materials.length);
          materials.push(m);
        }
      }

      for (const m of materials) {
        for (const key of ['map', 'emissiveMap', 'alphaMap']) {
          const t = m[key];
          if (t && t.isTexture) {
            t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
            t.needsUpdate = true;
          }
        }
      }


      const groups = g.groups.length ? g.groups : [{ start:0, count:posA.count, materialIndex:0 }];
      const uvA  = g.getAttribute('uv');

      for (const grp of groups) {
        const m = meshMats[grp.materialIndex];
        if (!m) continue;
        for (let vi=grp.start; vi<grp.start+grp.count; ++vi) {
          // This loop collects ALL colors from the original model to build the palette
          // It now correctly uses the linear-space sampler
          let col = (m.color ? m.color.clone() : new THREE.Color(1,1,1));
          if (m.emissive && m.emissive.getHSL({h:0,s:0,l:0}) > 0) {
            col.add(m.emissive);
          }
          if (uvA) {
            const uvv = new THREE.Vector2(uvA.getX(vi), uvA.getY(vi));
            for (const tex of allTextures(m)) {
              const samp = getSampler(tex);
              if (samp) col.multiply(samp(uvv));
            }
          }
          allRGB.push(col.r, col.g, col.b);
        }
      }

      if (uvA) { for (let i=0; i<posA.count; ++i) uvs.push(uvA.getX(i), uvA.getY(i)); }
      else { for (let i=0; i<posA.count; ++i) uvs.push(0,0); }

      for (const grp of groups) {
        const m = meshMats[grp.materialIndex]
        if (!m) continue;
        const globalMatIdx = matMap.get(m);
        for (let i=grp.start; i<grp.start+grp.count; i+=3) {
          indices.push(offset + i, offset + i + 1, offset + i + 2);
          triMats.push(globalMatIdx);
        }
      }

      offset += posA.count;
      geoms.push(g);
    });

    if (geoms.length === 0) {
      return { positions: new Float32Array(), uvs: new Float32Array(), indices: new Uint32Array(), triMats: new Uint32Array(), palette: new Float32Array(), materials: [] };
    }
    const merged = mergeGeometries(geoms, false);
    return {
      positions: merged.attributes.position.array,
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
      triMats: new Uint32Array(triMats),
      palette: kMeansPalette(new Float32Array(allRGB), this.paletteSize).palette,
      materials
    };
  }

}
