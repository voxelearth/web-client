/* paletteVoxelizer_fixed.js – fast GPU voxeliser with adaptive palette
 * GPL-3.0 • 2025‑06‑20 (REV‑G6: race‑free tri resolve, correct palette size, single‑gamma)
 */

import * as THREE from 'three';
import { storage, uniform, instanceIndex, wgslFn } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import StorageBufferAttribute from 'three/src/renderers/common/StorageBufferAttribute.js';

/* tiny 32‑bit popcount */
function popcnt32(n) {
  n -= (n >>> 1) & 0x55555555;
  n  = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

/* texture‑sampler cache (no gamma change – stays in texture colour space) */
const _samplers = new WeakMap();
function getSampler(tex) {
  if (_samplers.has(tex)) return _samplers.get(tex);
  let sampler = null, img = tex.image;
  const build = (arr, w, h) => {
    const { offset: off, repeat: rep, rotation: rot, center: cen, flipY } = tex;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    return uv => {
      let u = uv.x * rep.x + off.x;
      let v = uv.y * rep.y + off.y;
      if (rot !== 0) {
        u -= cen.x; v -= cen.y;
        const u2 = u * cosR - v * sinR;
        const v2 = u * sinR + v * cosR;
        u = u2 + cen.x; v = v2 + cen.y;
      }
      u = ((u % 1) + 1) % 1;
      v = ((v % 1) + 1) % 1;
      if (flipY) v = 1 - v;
      const xi = Math.floor(u * (w - 1)),
            yi = Math.floor(v * (h - 1)),
            idx = (yi * w + xi) * 4;
      return new THREE.Color(
        arr[idx]     / 255,
        arr[idx + 1] / 255,
        arr[idx + 2] / 255
      );
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
      const pix = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
      sampler = build(pix, cvs.width, cvs.height);
    }
  }
  _samplers.set(tex, sampler);
  return sampler;
}

/* colour‑bearing GLTF texture slots only */
const COLOR_MAP_KEYS = ['map', 'emissiveMap', 'alphaMap'];
function* allTextures(mat) {
  for (const k of COLOR_MAP_KEYS) {
    const t = mat[k];
    if (t && t.isTexture) yield t;
  }
}

/* K‑means palette (default 64 colours) */
function kMeansPalette(colors, k = 64, iters = 8) {
  const n = colors.length / 3;
  const cent = new Float32Array(k * 3),
        idx  = new Uint8Array(n),
        sel  = new Set();
  while (sel.size < k) sel.add(Math.floor(Math.random() * n));
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
      sums[best*3]   += r;
      sums[best*3+1] += g;
      sums[best*3+2] += b;
      cnts[best]++;
    }
    for (let c=0; c<k; ++c) {
      const ct = Math.max(1, cnts[c]);
      cent[c*3]   = sums[c*3]   / ct;
      cent[c*3+1] = sums[c*3+1] / ct;
      cent[c*3+2] = sums[c*3+2] / ct;
    }
  }
  return {
    palette: cent,
    indexOf(r,g,b){
      let best=0, bestD=1e9;
      for (let c=0; c<k; ++c) {
        const dr=r-cent[c*3], dg=g-cent[c*3+1], db=b-cent[c*3+2],
              d = dr*dr + dg*dg + db*db;
        if (d < bestD) { bestD = d; best = c; }
      }
      return best + 1; // 0 = empty
    }
  };
}

/* ====================================================================== */
export default class PaletteVoxelizer {

  async init({ renderer, model,
               voxelSize=0.01,
               maxGrid=Infinity,
               paletteSize=256 }) {

    this.renderer    = renderer;
    this.voxelSize   = voxelSize;
    this.paletteSize = paletteSize;

    // 1) Bake + merge: positions, uvs, indices, triMats, palette, materials
    const baked = this.#bakeAndMerge(model);
    this.positions = baked.positions;
    this.uvs       = baked.uvs;
    this.indices   = baked.indices;
    this.triMats   = baked.triMats;
    this.palette   = baked.palette;
    this.materials = baked.materials;

    // 2) GPU buffers
    this.posBuf = new StorageBufferAttribute(this.positions, 3);
    this.uvBuf  = new StorageBufferAttribute(this.uvs,       2);
    this.idxBuf = new StorageBufferAttribute(this.indices,    1);
    this.matBuf = new StorageBufferAttribute(this.triMats,    1);

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
    this.voxelSize  /= scale;
    this.voxelCount  = this.grid.x * this.grid.y * this.grid.z;

    // 4) Allocate bit, tri & distance grids
    const bitWords = Math.ceil(this.voxelCount/32),
          triWords = this.voxelCount;
    this.bitGrid  = new StorageBufferAttribute(new Uint32Array(bitWords),1);
    this.triGrid  = new StorageBufferAttribute(new Uint32Array(triWords),1);
    // distance grid initialised to +INF (0x7f800000)
    const distInit = new Uint32Array(triWords);
    distInit.fill(0x7f800000);
    this.distGrid = new StorageBufferAttribute(distInit,1);

    // 5) Clear grids (also resets distGrid)
    const clearWGSL = wgslFn(`
fn compute(
  bits : ptr<storage, array<atomic<u32>>, read_write>,
  tris : ptr<storage, array<u32>,         read_write>,
  dists: ptr<storage, array<atomic<u32>>, read_write>,
  id   : u32
) -> void {
  if (id < arrayLength(bits)) {
    atomicStore(&bits[id], 0u);
  }
  if (id < arrayLength(tris)) {
    tris[id] = 0u;
  }
  if (id < arrayLength(dists)) {
    atomicStore(&dists[id], 0x7f800000u);
  }
}`);
    await renderer.computeAsync(
      clearWGSL({
        bits:  storage(this.bitGrid, 'atomic<u32>', this.bitGrid.count),
        tris:  storage(this.triGrid,'u32',          this.triGrid.count),
        dists: storage(this.distGrid,'atomic<u32>', this.distGrid.count),
        id:    instanceIndex
      }).compute(Math.max(bitWords,triWords)),
      [64,1,1]
    );

    // 6) Raster kernel – keeps closest triangle per voxel (race‑free)
    const rasterWGSL = wgslFn(/* wgsl */`
fn compute(
  pos  : ptr<storage, array<vec3<f32>>,  read>,
  uv   : ptr<storage, array<vec2<f32>>,  read>,
  ind  : ptr<storage, array<u32>,        read>,
  mat  : ptr<storage, array<u32>,        read>,
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
          tris[flat] = triId;
        }
        // mark occupancy regardless (any triangle touching sets bit)
        atomicOr(&bits[bw], bm);
      }
    }
  }
}`); // WGSL

    const triCount = this.indices.length / 3;
    await renderer.computeAsync(
      rasterWGSL({
        pos:   storage(this.posBuf,'vec3', this.posBuf.count).toReadOnly(),
        uv:    storage(this.uvBuf,'vec2', this.uvBuf.count).toReadOnly(),
        ind:   storage(this.idxBuf,'u32', this.idxBuf.count).toReadOnly(),
        mat:   storage(this.matBuf,'u32', this.matBuf.count).toReadOnly(),
        bits:  storage(this.bitGrid, 'atomic<u32>', this.bitGrid.count),
        tris:  storage(this.triGrid,'u32',           this.triGrid.count),
        dists: storage(this.distGrid,'atomic<u32>',  this.distGrid.count),
        gDim:  uniform(this.grid),
        bMin:  uniform(this.bbox.min),
        vSz:   uniform(this.voxelSize),
        triId: instanceIndex
      }).compute(triCount),
      [64,1,1]
    );

    // 7) CPU sample & build instanced mesh with affine UV + palette lookup
    await this.#buildInstancedMesh();
  }

  async #buildInstancedMesh() {
    const bitsCPU = new Uint32Array(
      await this.renderer.getArrayBufferAsync(this.bitGrid)
    );
    const trisCPU = new Uint32Array(
      await this.renderer.getArrayBufferAsync(this.triGrid)
    );

    let active = 0;
    for (const w of bitsCPU) active += popcnt32(w);
    this.activeVoxelCount = active;

    if (active === 0) {
      this.voxelMesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial()
      );
      return;
    }

    const centers = new Float32Array(active * 3),
          colors  = new Float32Array(active * 3);

    let ptr = 0, cptr = 0, flat = 0;
    const nx = this.grid.x, ny = this.grid.y;

    const posArr  = this.positions,
          uvArr   = this.uvs,
          idxArr  = this.indices,
          triMats = this.triMats,
          palette = this.palette,
          mats    = this.materials;

    for (let wIdx = 0; wIdx < bitsCPU.length; ++wIdx) {
      let word = bitsCPU[wIdx];
      if (word === 0) { flat += 32; continue; }
      for (let b = 0; b < 32 && flat < this.voxelCount; ++b, ++flat) {
        if ((word & 1) === 0) { word >>>= 1; continue; }
        word >>>= 1;

        const z   = Math.floor(flat / (nx * ny)),
              rem = flat - z * nx * ny,
              y   = Math.floor(rem / nx),
              x   = rem - y * nx;

        const cx = this.bbox.min.x + (x + 0.5) * this.voxelSize;
        const cy = this.bbox.min.y + (y + 0.5) * this.voxelSize;
        const cz = this.bbox.min.z + (z + 0.5) * this.voxelSize;

        centers[ptr++] = cx;
        centers[ptr++] = cy;
        centers[ptr++] = cz;

        // affine barycentric UV interpolation
        const tId = trisCPU[flat];
        const i0  = idxArr[tId*3], i1 = idxArr[tId*3+1], i2 = idxArr[tId*3+2];

        const uv0 = new THREE.Vector2(uvArr[i0*2],   uvArr[i0*2+1]),
              uv1 = new THREE.Vector2(uvArr[i1*2],   uvArr[i1*2+1]),
              uv2 = new THREE.Vector2(uvArr[i2*2],   uvArr[i2*2+1]);

        const v0  = new THREE.Vector3(posArr[i0*3],  posArr[i0*3+1],  posArr[i0*3+2]),
              v1  = new THREE.Vector3(posArr[i1*3],  posArr[i1*3+1],  posArr[i1*3+2]),
              v2  = new THREE.Vector3(posArr[i2*3],  posArr[i2*3+1],  posArr[i2*3+2]),
              p   = new THREE.Vector3(cx, cy, cz);

        // compute barycentric
        const e0  = v1.clone().sub(v0),
              e1  = v2.clone().sub(v0),
              ep  = p.clone().sub(v0),
              d00 = e0.dot(e0),
              d01 = e0.dot(e1),
              d11 = e1.dot(e1),
              d20 = ep.dot(e0),
              d21 = ep.dot(e1),
              denom = d00*d11 - d01*d01,
              vv = (d11*d20 - d01*d21)/denom,
              ww = (d00*d21 - d01*d20)/denom,
              uu = 1 - vv - ww;

        const uvp = new THREE.Vector2(
          uu * uv0.x + vv * uv1.x + ww * uv2.x,
          uu * uv0.y + vv * uv1.y + ww * uv2.y
        );

        // sample material colour (only colour maps)
        const matId = triMats[tId],
              mat   = mats[matId] || mats[0];
        let col = (mat.color || new THREE.Color(1,1,1)).clone();
        for (const tex of allTextures(mat)) {
          const s = getSampler(tex);
          if (s) col.multiply(s(uvp));
        }

        // palette lookup in texture space (single‑gamma)
        let best=0, bestD=1e9;
        for (let c=0; c<this.paletteSize; ++c) {
          const dr=col.r - palette[c*3],
                dg=col.g - palette[c*3+1],
                db=col.b - palette[c*3+2],
                d = dr*dr + dg*dg + db*db;
          if (d < bestD) { bestD = d; best = c; }
        }
        colors[cptr++] = palette[best*3];
        colors[cptr++] = palette[best*3+1];
        colors[cptr++] = palette[best*3+2];
      }
    }

    // build instanced mesh
    const cube = new THREE.BoxGeometry(this.voxelSize, this.voxelSize, this.voxelSize);
    const matM = new THREE.MeshStandardMaterial({ vertexColors:true });
    const inst = new THREE.InstancedMesh(cube, matM, active);
    const M4   = new THREE.Matrix4();
    for (let i=0; i<active; ++i){
      M4.makeTranslation(
        centers[i*3],
        centers[i*3+1],
        centers[i*3+2]
      );
      inst.setMatrixAt(i, M4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.instanceColor = new THREE.InstancedBufferAttribute(colors,3);
    inst.instanceColor.needsUpdate = true;
    inst.frustumCulled = false;
    this.voxelMesh = inst;
  }

  /* bake+merge → positions, uvs, indices, triMats, palette, materials */
  #bakeAndMerge(root) {
    const geoms     = [],
          indices   = [],
          allRGB    = [],
          triMats   = [],
          uvs       = [],
          materials = [];
    const matMap    = new Map();
    let offset = 0;

    root.traverse(o => {
      if (!o.isMesh) return;
      const geom = o.geometry;
      if (!geom.getAttribute('position')) return;

      // clone→world→nonIndexed
      let g = geom.clone().applyMatrix4(o.matrixWorld).toNonIndexed();

      // collect mesh materials globally
      const meshMats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of meshMats) {
        if (!matMap.has(m)) {
          matMap.set(m, materials.length);
          materials.push(m);
        }
      }

      const groups = g.groups.length
                   ? g.groups
                   : [{ start:0, count:g.attributes.position.count, materialIndex:0 }];

      // bake per‑vertex colour (single‑gamma)
      const posA = g.getAttribute('position'),
            uvA  = g.getAttribute('uv'),
            cArr = new Float32Array(posA.count*3);

      for (const grp of groups) {
        const m = meshMats[grp.materialIndex];
        for (let vi=grp.start; vi<grp.start+grp.count; ++vi) {
          let col = (m.color || new THREE.Color(1,1,1)).clone();
          if (uvA) {
            const uvv = new THREE.Vector2(uvA.getX(vi), uvA.getY(vi));
            for (const tex of allTextures(m)) {
              const samp = getSampler(tex);
              if (samp) col.multiply(samp(uvv));
            }
          }
          cArr[vi*3]   = col.r;
          cArr[vi*3+1] = col.g;
          cArr[vi*3+2] = col.b;
          allRGB.push(col.r, col.g, col.b);
        }
      }
      g.setAttribute('color', new THREE.BufferAttribute(cArr,3));

      // collect uvs
      for (let vi=0; vi<posA.count; ++vi) {
        if (uvA) uvs.push(uvA.getX(vi), uvA.getY(vi));
        else     uvs.push(0,0);
      }

      // build indices + triMats
      for (const grp of groups) {
        const globalMat = matMap.get(meshMats[grp.materialIndex]);
        for (let i=grp.start; i<grp.start+grp.count; i+=3) {
          indices.push(offset + i, offset + i + 1, offset + i + 2);
          triMats.push(globalMat);
        }
      }

      offset += posA.count;
      geoms.push(g);
    });

    const merged = mergeGeometries(geoms, false);
    const positions = merged.attributes.position.array;
    const indicesA  = new Uint32Array(indices);
    const uvsA      = new Float32Array(uvs);
    const triMatsA  = new Uint32Array(triMats);
    const { palette } = kMeansPalette(new Float32Array(allRGB), this.paletteSize);

    return {
      positions,
      uvs:       uvsA,
      indices:   indicesA,
      triMats:   triMatsA,
      palette,
      materials
    };
  }

}
