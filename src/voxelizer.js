import * as THREE from 'three';
import { storage, uniform, instanceIndex, wgslFn } from 'three/tsl';
import StorageBufferAttribute from 'three/src/renderers/common/StorageBufferAttribute.js';

const LEGACY_SRGB_ENCODING = 3001;
const MAX_GPU_BYTES = 256 * 1024 * 1024;
const BYTES_PER_VOXEL = 8.2;
const TILE_EDGE = Math.max(1, Math.floor(Math.cbrt(MAX_GPU_BYTES / BYTES_PER_VOXEL)));
const MAX_VERTICES_PER_MESH = 65536 * 4;
const MAIN_THREAD_SLICE_MS = 4;

const CUBE_FACES = [
  { dir: [1, 0, 0], normal: [127, 0, 0], vertices: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], normal: [-127, 0, 0], vertices: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { dir: [0, 1, 0], normal: [0, 127, 0], vertices: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], normal: [0, -127, 0], vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], normal: [0, 0, 127], vertices: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], normal: [0, 0, -127], vertices: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

function isSRGBTexture(tex) {
  return !!tex && (
    tex.colorSpace === THREE.SRGBColorSpace
    || tex.encoding === LEGACY_SRGB_ENCODING
  );
}

function srgbToLinearChannel(value) {
  if (value <= 0.04045) return value / 12.92;
  return Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgbChannel(value) {
  if (value <= 0.0031308) return value * 12.92;
  return 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function clampByte(value) {
  const scaled = Math.round(value * 255);
  if (scaled <= 0) return 0;
  if (scaled >= 255) return 255;
  return scaled;
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function createYieldState(sliceMs = MAIN_THREAD_SLICE_MS) {
  return { sliceMs, deadline: nowMs() + sliceMs };
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function maybeYieldToBrowser(yieldState, mainThreadPolicy = null) {
  if (!yieldState) return;
  if (mainThreadPolicy?.shouldPause?.()) {
    await (mainThreadPolicy.waitForIdle?.() ?? nextFrame());
    yieldState.deadline = nowMs() + yieldState.sliceMs;
    return;
  }
  if (nowMs() < yieldState.deadline) return;
  await nextFrame();
  yieldState.deadline = nowMs() + yieldState.sliceMs;
}

async function runWithConcurrency(items, limit, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(Array.from({ length: runnerCount }, async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) break;
      results[current] = await worker(items[current], current);
    }
  }));

  return results;
}

const _samplers = new WeakMap();
function getSampler(tex) {
  if (!tex) return null;
  if (_samplers.has(tex)) return _samplers.get(tex);

  let sampler = null;
  const img = tex.image;

  const build = (arr, width, height) => {
    const { offset, repeat, rotation, center, flipY, wrapS, wrapT } = tex;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    return (uv, wantRGBA = false, target = null) => {
      let u = uv.x * repeat.x + offset.x;
      let v = uv.y * repeat.y + offset.y;

      if (rotation !== 0) {
        u -= center.x;
        v -= center.y;
        const rotatedU = u * cosR - v * sinR;
        const rotatedV = u * sinR + v * cosR;
        u = rotatedU + center.x;
        v = rotatedV + center.y;
      }

      u = wrapS === THREE.RepeatWrapping ? ((u % 1) + 1) % 1 : THREE.MathUtils.clamp(u, 0, 1);
      v = wrapT === THREE.RepeatWrapping ? ((v % 1) + 1) % 1 : THREE.MathUtils.clamp(v, 0, 1);
      if (flipY) v = 1 - v;

      const x = u * (width - 1);
      const y = v * (height - 1);
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const tx = x - x0;
      const ty = y - y0;

      const i00 = (y0 * width + x0) * 4;
      const i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const lerp = (a, b, t) => a + (b - a) * t;

      let r = lerp(lerp(arr[i00], arr[i10], tx), lerp(arr[i01], arr[i11], tx), ty) / 255;
      let g = lerp(lerp(arr[i00 + 1], arr[i10 + 1], tx), lerp(arr[i01 + 1], arr[i11 + 1], tx), ty) / 255;
      let b = lerp(lerp(arr[i00 + 2], arr[i10 + 2], tx), lerp(arr[i01 + 2], arr[i11 + 2], tx), ty) / 255;

      if (isSRGBTexture(tex)) {
        r = srgbToLinearChannel(r);
        g = srgbToLinearChannel(g);
        b = srgbToLinearChannel(b);
      }

      if (wantRGBA) {
        const rgba = target ?? { r: 0, g: 0, b: 0, a: 1 };
        rgba.r = r;
        rgba.g = g;
        rgba.b = b;
        rgba.a = lerp(lerp(arr[i00 + 3], arr[i10 + 3], tx), lerp(arr[i01 + 3], arr[i11 + 3], tx), ty) / 255;
        return rgba;
      }

      const color = target ?? new THREE.Color();
      color.r = r;
      color.g = g;
      color.b = b;
      return color;
    };
  };

  if (img) {
    if (img.data && img.width && img.height) {
      sampler = build(img.data, img.width, img.height);
    } else if (img.width && img.height && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      sampler = build(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    }
  }

  _samplers.set(tex, sampler);
  return sampler;
}

const COLOR_MAP_KEYS = ['map', 'emissiveMap'];
function* allTextures(material) {
  for (const key of COLOR_MAP_KEYS) {
    const texture = material[key];
    if (texture && texture.isTexture) yield texture;
  }
}

function kMeansPalette(colors, k = 64, iterations = 8) {
  const count = colors.length / 3;
  if (count === 0) return { palette: new Float32Array(k * 3) };

  const centroids = new Float32Array(k * 3);
  const assignments = new Uint8Array(count);
  const selected = new Set();

  while (selected.size < k && selected.size < count) {
    selected.add(Math.floor(Math.random() * count));
  }

  let centroidIndex = 0;
  for (const sample of selected) {
    centroids[centroidIndex++] = colors[sample * 3];
    centroids[centroidIndex++] = colors[sample * 3 + 1];
    centroids[centroidIndex++] = colors[sample * 3 + 2];
  }

  const sums = new Float32Array(k * 3);
  const counts = new Uint32Array(k);

  for (let iteration = 0; iteration < iterations; iteration++) {
    sums.fill(0);
    counts.fill(0);
    for (let pixel = 0; pixel < count; pixel++) {
      const r = colors[pixel * 3];
      const g = colors[pixel * 3 + 1];
      const b = colors[pixel * 3 + 2];
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let centroid = 0; centroid < k; centroid++) {
        const dr = r - centroids[centroid * 3];
        const dg = g - centroids[centroid * 3 + 1];
        const db = b - centroids[centroid * 3 + 2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = centroid;
        }
      }
      assignments[pixel] = best;
      sums[best * 3] += r;
      sums[best * 3 + 1] += g;
      sums[best * 3 + 2] += b;
      counts[best]++;
    }
    for (let centroid = 0; centroid < k; centroid++) {
      const divisor = Math.max(1, counts[centroid]);
      centroids[centroid * 3] = sums[centroid * 3] / divisor;
      centroids[centroid * 3 + 1] = sums[centroid * 3 + 1] / divisor;
      centroids[centroid * 3 + 2] = sums[centroid * 3 + 2] / divisor;
    }
  }

  return { palette: centroids };
}

function nearestPaletteId(r, g, b, palette, paletteCount) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < paletteCount; index++) {
    const base = index * 3;
    const dr = r - palette[base];
    const dg = g - palette[base + 1];
    const db = b - palette[base + 2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex + 1;
}

function buildMaterialInfo(material, palette, paletteCount) {
  if (!material) return null;

  let baseR = material.color?.r ?? 1;
  let baseG = material.color?.g ?? 1;
  let baseB = material.color?.b ?? 1;
  if (material.emissive) {
    baseR += material.emissive.r;
    baseG += material.emissive.g;
    baseB += material.emissive.b;
  }

  const colorSamplers = [];
  for (const texture of allTextures(material)) {
    const sampler = getSampler(texture);
    if (sampler) colorSamplers.push(sampler);
  }

  const alphaSampler = material.alphaMap ? getSampler(material.alphaMap) : null;
  const opacity = material.opacity ?? 1;
  const constantPaletteId = (!colorSamplers.length && !alphaSampler && opacity >= 0.5)
    ? nearestPaletteId(baseR, baseG, baseB, palette, paletteCount)
    : 0;

  return {
    baseR,
    baseG,
    baseB,
    colorSamplers,
    alphaSampler,
    opacity,
    constantPaletteId,
  };
}

function createEmptyVoxelMesh() {
  return new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ toneMapped: false })
  );
}

export default class PaletteVoxelizer {
  async init({
    renderer,
    model,
    voxelSize = 0.01,
    maxGrid = Infinity,
    paletteSize = 256,
    needGrid = false,
  }) {
    const startedAt = performance.now();
    this.renderer = renderer;
    this.voxelSize = voxelSize;
    this.paletteSize = paletteSize;
    this.needGrid = needGrid;
    this._voxelGrid = null;
    this.voxelCount = 0;
    this.mainThreadPolicy = null;

    if (!renderer || typeof renderer.computeAsync !== 'function' || typeof renderer.getArrayBufferAsync !== 'function') {
      throw new Error('WebGPU compute renderer unavailable');
    }

    const bakeStartedAt = performance.now();
    const baked = await this.#bakeAndMerge(model);
    const bakeMs = performance.now() - bakeStartedAt;

    this.positions = baked.positions;
    this.uvs = baked.uvs;
    this.indices = baked.indices;
    this.triMats = baked.triMats;
    this.palette = baked.palette;
    this.materials = baked.materials;
    this.paletteCount = Math.min(this.paletteSize, this.palette.length / 3);

    if (!this.positions.length || !this.indices.length) {
      this.voxelMesh = createEmptyVoxelMesh();
      this.stats = {
        method: 'webgpu',
        bakeMs,
        rasterMs: 0,
        postprocessMs: 0,
        meshMs: 0,
        gridExportMs: 0,
        gpuMs: 0,
        totalMs: performance.now() - startedAt,
      };
      return;
    }

    this.posBuf = new StorageBufferAttribute(this.positions, 3);
    this.uvBuf = new StorageBufferAttribute(this.uvs, 2);
    this.idxBuf = new StorageBufferAttribute(this.indices, 1);
    this.matBuf = new StorageBufferAttribute(this.triMats, 1);

    this.bbox = new THREE.Box3().setFromObject(model);
    const size = this.bbox.getSize(new THREE.Vector3());
    const nx = Math.ceil(size.x / voxelSize);
    const ny = Math.ceil(size.y / voxelSize);
    const nz = Math.ceil(size.z / voxelSize);
    const maxDim = Math.max(nx, ny, nz);
    const scale = Number.isFinite(maxGrid) && maxDim > maxGrid ? maxGrid / maxDim : 1;

    this.grid = new THREE.Vector3(
      Math.ceil(nx * scale),
      Math.ceil(ny * scale),
      Math.ceil(nz * scale)
    );
    this.voxelSize /= scale;
    this.totalGridVoxelCount = this.grid.x * this.grid.y * this.grid.z;

    this.bitGrid = this.triGrid = this.distGrid = new StorageBufferAttribute(new Uint32Array(0), 1);

    this._clearWGSL = wgslFn(`
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

    this._rasterWGSL = wgslFn(`
fn compute(
  pos  : ptr<storage, array<vec3<f32>>,  read>,
  ind  : ptr<storage, array<u32>,        read>,
  bits : ptr<storage, array<atomic<u32>>, read_write>,
  tris : ptr<storage, array<u32>,         read_write>,
  dists: ptr<storage, array<atomic<u32>>, read_write>,
  gDim : vec3<u32>, bMin : vec3<f32>, vSz : f32, triId : u32
) -> void {
  let i0 = ind[triId * 3u];
  let i1 = ind[triId * 3u + 1u];
  let i2 = ind[triId * 3u + 2u];

  let v0 = pos[i0];
  let v1 = pos[i1];
  let v2 = pos[i2];

  let tMin = min(min(v0, v1), v2);
  let tMax = max(max(v0, v1), v2);
  var vMin = max(vec3<u32>(0u), vec3<u32>((tMin - bMin) / vSz));
  var vMax = min(gDim - vec3<u32>(1u), vec3<u32>((tMax - bMin) / vSz));

  let half = vSz * 0.5;
  let nx = gDim.x;
  let ny = gDim.y;

  let n = cross(v1 - v0, v2 - v0);
  let absN = abs(n);
  let nn = dot(n, n);

  for (var z = vMin.z; z <= vMax.z; z = z + 1u) {
    for (var y = vMin.y; y <= vMax.y; y = y + 1u) {
      for (var x = vMin.x; x <= vMax.x; x = x + 1u) {
        let c = bMin + (vec3<f32>(f32(x), f32(y), f32(z)) + vec3<f32>(0.5)) * vSz;
        let tv0 = v0 - c;
        let tv1 = v1 - c;
        let tv2 = v2 - c;
        let rP = half * (absN.x + absN.y + absN.z);
        if (abs(dot(n, tv0)) > rP) { continue; }

        let e0 = tv1 - tv0;
        let e1 = tv2 - tv1;
        let e2 = tv0 - tv2;

        {
          let axis = cross(e0, vec3<f32>(1.0, 0.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.y) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e0, vec3<f32>(0.0, 1.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e0, vec3<f32>(0.0, 0.0, 1.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.y));
          if (mn > r || mx < -r) { continue; }
        }

        {
          let axis = cross(e1, vec3<f32>(1.0, 0.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.y) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e1, vec3<f32>(0.0, 1.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e1, vec3<f32>(0.0, 0.0, 1.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.y));
          if (mn > r || mx < -r) { continue; }
        }

        {
          let axis = cross(e2, vec3<f32>(1.0, 0.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.y) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e2, vec3<f32>(0.0, 1.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e2, vec3<f32>(0.0, 0.0, 1.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.y));
          if (mn > r || mx < -r) { continue; }
        }

        let flat = x + y * nx + z * nx * ny;
        let bw = flat >> 5u;
        let bm = 1u << (flat & 31u);

        let dist2 = (dot(n, tv0) * dot(n, tv0)) / nn;
        let dBits = bitcast<u32>(dist2);
        let prev = atomicMin(&dists[flat], dBits);

        if (dBits < prev) {
          tris[flat] = triId + 1u;
        }

        atomicOr(&bits[bw], bm);
      }
    }
  }
}`);

    await nextFrame();

    const buildStartedAt = performance.now();
    const buildStats = await this.#buildInstancedMesh();
    const gpuMs = performance.now() - buildStartedAt;

    this.stats = {
      method: 'webgpu',
      bakeMs,
      rasterMs: buildStats.rasterMs,
      postprocessMs: buildStats.postprocessMs,
      meshMs: buildStats.meshMs,
      gridExportMs: buildStats.gridExportMs,
      gpuMs,
      totalMs: performance.now() - startedAt,
    };
  }

  async prepareWorkerPayload({
    renderer,
    model,
    voxelSize = 0.01,
    maxGrid = Infinity,
    paletteSize = 256,
    needGrid = false,
    mainThreadPolicy = null,
  }) {
    const startedAt = performance.now();
    this.renderer = renderer;
    this.voxelSize = voxelSize;
    this.paletteSize = paletteSize;
    this.needGrid = needGrid;
    this.mainThreadPolicy = mainThreadPolicy;
    this._voxelGrid = null;
    this.voxelCount = 0;

    if (!renderer || typeof renderer.computeAsync !== 'function' || typeof renderer.getArrayBufferAsync !== 'function') {
      throw new Error('WebGPU compute renderer unavailable');
    }

    const bakeStartedAt = performance.now();
    const baked = await this.#bakeAndMerge(model);
    const bakeMs = performance.now() - bakeStartedAt;

    this.positions = baked.positions;
    this.uvs = baked.uvs;
    this.indices = baked.indices;
    this.triMats = baked.triMats;
    this.palette = baked.palette;
    this.materials = baked.materials;
    this.paletteCount = Math.min(this.paletteSize, this.palette.length / 3);

    if (!this.positions.length || !this.indices.length) {
      return {
        bakedData: {
          positions: this.positions,
          uvs: this.uvs,
          indices: this.indices,
          triMats: this.triMats,
          palette: this.palette,
          materialUuids: [],
          bbox: { min: [0, 0, 0], max: [0, 0, 0] },
          grid: { x: 0, y: 0, z: 0 },
          voxelSize: this.voxelSize,
          stats: {
            bakeMs,
            rasterMs: 0,
            totalMs: performance.now() - startedAt,
          },
        },
        rasterTiles: [],
      };
    }

    this.posBuf = new StorageBufferAttribute(this.positions, 3);
    this.uvBuf = new StorageBufferAttribute(this.uvs, 2);
    this.idxBuf = new StorageBufferAttribute(this.indices, 1);
    this.matBuf = new StorageBufferAttribute(this.triMats, 1);

    this.bbox = new THREE.Box3().setFromObject(model);
    const size = this.bbox.getSize(new THREE.Vector3());
    const nx = Math.ceil(size.x / voxelSize);
    const ny = Math.ceil(size.y / voxelSize);
    const nz = Math.ceil(size.z / voxelSize);
    const maxDim = Math.max(nx, ny, nz);
    const scale = Number.isFinite(maxGrid) && maxDim > maxGrid ? maxGrid / maxDim : 1;

    this.grid = new THREE.Vector3(
      Math.ceil(nx * scale),
      Math.ceil(ny * scale),
      Math.ceil(nz * scale)
    );
    this.voxelSize /= scale;
    this.totalGridVoxelCount = this.grid.x * this.grid.y * this.grid.z;

    this.bitGrid = this.triGrid = this.distGrid = new StorageBufferAttribute(new Uint32Array(0), 1);

    this._clearWGSL = wgslFn(`
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

    this._rasterWGSL = wgslFn(`
fn compute(
  pos  : ptr<storage, array<vec3<f32>>,  read>,
  ind  : ptr<storage, array<u32>,        read>,
  bits : ptr<storage, array<atomic<u32>>, read_write>,
  tris : ptr<storage, array<u32>,         read_write>,
  dists: ptr<storage, array<atomic<u32>>, read_write>,
  gDim : vec3<u32>, bMin : vec3<f32>, vSz : f32, triId : u32
) -> void {
  let i0 = ind[triId * 3u];
  let i1 = ind[triId * 3u + 1u];
  let i2 = ind[triId * 3u + 2u];

  let v0 = pos[i0];
  let v1 = pos[i1];
  let v2 = pos[i2];

  let tMin = min(min(v0, v1), v2);
  let tMax = max(max(v0, v1), v2);
  var vMin = max(vec3<u32>(0u), vec3<u32>((tMin - bMin) / vSz));
  var vMax = min(gDim - vec3<u32>(1u), vec3<u32>((tMax - bMin) / vSz));

  let half = vSz * 0.5;
  let nx = gDim.x;
  let ny = gDim.y;

  let n = cross(v1 - v0, v2 - v0);
  let absN = abs(n);
  let nn = dot(n, n);

  for (var z = vMin.z; z <= vMax.z; z = z + 1u) {
    for (var y = vMin.y; y <= vMax.y; y = y + 1u) {
      for (var x = vMin.x; x <= vMax.x; x = x + 1u) {
        let c = bMin + (vec3<f32>(f32(x), f32(y), f32(z)) + vec3<f32>(0.5)) * vSz;
        let tv0 = v0 - c;
        let tv1 = v1 - c;
        let tv2 = v2 - c;
        let rP = half * (absN.x + absN.y + absN.z);
        if (abs(dot(n, tv0)) > rP) { continue; }

        let e0 = tv1 - tv0;
        let e1 = tv2 - tv1;
        let e2 = tv0 - tv2;

        {
          let axis = cross(e0, vec3<f32>(1.0, 0.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.y) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e0, vec3<f32>(0.0, 1.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e0, vec3<f32>(0.0, 0.0, 1.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.y));
          if (mn > r || mx < -r) { continue; }
        }

        {
          let axis = cross(e1, vec3<f32>(1.0, 0.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.y) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e1, vec3<f32>(0.0, 1.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e1, vec3<f32>(0.0, 0.0, 1.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.y));
          if (mn > r || mx < -r) { continue; }
        }

        {
          let axis = cross(e2, vec3<f32>(1.0, 0.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.y) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e2, vec3<f32>(0.0, 1.0, 0.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.z));
          if (mn > r || mx < -r) { continue; }
        }
        {
          let axis = cross(e2, vec3<f32>(0.0, 0.0, 1.0));
          let p0 = dot(axis, tv0);
          let p1 = dot(axis, tv1);
          let p2 = dot(axis, tv2);
          let mn = min(p0, min(p1, p2));
          let mx = max(p0, max(p1, p2));
          let r = half * (abs(axis.x) + abs(axis.y));
          if (mn > r || mx < -r) { continue; }
        }

        let flat = x + y * nx + z * nx * ny;
        let bw = flat >> 5u;
        let bm = 1u << (flat & 31u);

        let dist2 = (dot(n, tv0) * dot(n, tv0)) / nn;
        let dBits = bitcast<u32>(dist2);
        let prev = atomicMin(&dists[flat], dBits);

        if (dBits < prev) {
          tris[flat] = triId + 1u;
        }

        atomicOr(&bits[bw], bm);
      }
    }
  }
}`);

    await nextFrame();
    const rasterStartedAt = performance.now();
    const rasterTiles = await this.#rasterizeTilesForWorker();
    const rasterMs = performance.now() - rasterStartedAt;

    return {
      bakedData: {
        positions: this.positions,
        uvs: this.uvs,
        indices: this.indices,
        triMats: this.triMats,
        palette: this.palette,
        materialUuids: this.materials.map((material) => material?.uuid ?? ''),
        bbox: {
          min: [this.bbox.min.x, this.bbox.min.y, this.bbox.min.z],
          max: [this.bbox.max.x, this.bbox.max.y, this.bbox.max.z],
        },
        grid: {
          x: this.grid.x | 0,
          y: this.grid.y | 0,
          z: this.grid.z | 0,
        },
        voxelSize: this.voxelSize,
        stats: {
          bakeMs,
          rasterMs,
          totalMs: performance.now() - startedAt,
        },
      },
      rasterTiles,
    };
  }

  async #rasterizeTilesForWorker() {
    const { grid, voxelSize, bbox } = this;
    const NX = grid.x;
    const NY = grid.y;
    const NZ = grid.z;
    const renderer = this.renderer;
    const posBuf = storage(this.posBuf, 'vec3', this.posBuf.count).toReadOnly();
    const idxBuf = storage(this.idxBuf, 'u32', this.idxBuf.count).toReadOnly();

    const tileDescriptors = [];
    for (let oz = 0; oz < NZ; oz += TILE_EDGE) {
      const tz = Math.min(TILE_EDGE, NZ - oz);
      for (let oy = 0; oy < NY; oy += TILE_EDGE) {
        const ty = Math.min(TILE_EDGE, NY - oy);
        for (let ox = 0; ox < NX; ox += TILE_EDGE) {
          const tx = Math.min(TILE_EDGE, NX - ox);
          tileDescriptors.push({ ox, oy, oz, tx, ty, tz });
        }
      }
    }

    const concurrency = Math.max(
      1,
      Math.min(
        typeof window !== 'undefined' ? 1 : 4,
        Math.floor((globalThis.navigator?.hardwareConcurrency ?? 4) / 2) || 1
      )
    );

    return runWithConcurrency(tileDescriptors, concurrency, async ({ ox, oy, oz, tx, ty, tz }) => {
      const tileVoxelCount = tx * ty * tz;
      const bitWords = Math.ceil(tileVoxelCount / 32);
      const bitBuf = new StorageBufferAttribute(new Uint32Array(bitWords), 1);
      const triBuf = new StorageBufferAttribute(new Uint32Array(tileVoxelCount), 1);
      const distInit = new Uint32Array(tileVoxelCount);
      distInit.fill(0x7f800000);
      const distBuf = new StorageBufferAttribute(distInit, 1);

      await renderer.computeAsync(
        this._clearWGSL({
          bits: storage(bitBuf, 'atomic<u32>', bitBuf.count),
          tris: storage(triBuf, 'u32', triBuf.count),
          dists: storage(distBuf, 'atomic<u32>', distBuf.count),
          id: instanceIndex,
        }).compute(Math.max(bitWords, tileVoxelCount))
      );

      const tileMin = new THREE.Vector3(
        bbox.min.x + ox * voxelSize,
        bbox.min.y + oy * voxelSize,
        bbox.min.z + oz * voxelSize
      );

      await renderer.computeAsync(
        this._rasterWGSL({
          pos: posBuf,
          ind: idxBuf,
          bits: storage(bitBuf, 'atomic<u32>', bitBuf.count),
          tris: storage(triBuf, 'u32', triBuf.count),
          dists: storage(distBuf, 'atomic<u32>', distBuf.count),
          gDim: uniform(new THREE.Vector3(tx, ty, tz)),
          bMin: uniform(tileMin),
          vSz: uniform(voxelSize),
          triId: instanceIndex,
        }).compute(this.indices.length / 3)
      );

      return {
        ox,
        oy,
        oz,
        tx,
        ty,
        tz,
        tris: new Uint32Array(await renderer.getArrayBufferAsync(triBuf)),
      };
    });
  }

  async #buildInstancedMesh() {
    const { grid, voxelSize, bbox } = this;
    const NX = grid.x;
    const NY = grid.y;
    const NZ = grid.z;
    const sliceStride = NX * NY;
    const renderer = this.renderer;
    const posBuf = storage(this.posBuf, 'vec3', this.posBuf.count).toReadOnly();
    const idxBuf = storage(this.idxBuf, 'u32', this.idxBuf.count).toReadOnly();
    const paletteIds = new Uint16Array(this.totalGridVoxelCount);
    const materialInfos = this.materials.map(material => buildMaterialInfo(material, this.palette, this.paletteCount));

    const tileDescriptors = [];
    for (let oz = 0; oz < NZ; oz += TILE_EDGE) {
      const tz = Math.min(TILE_EDGE, NZ - oz);
      for (let oy = 0; oy < NY; oy += TILE_EDGE) {
        const ty = Math.min(TILE_EDGE, NY - oy);
        for (let ox = 0; ox < NX; ox += TILE_EDGE) {
          const tx = Math.min(TILE_EDGE, NX - ox);
          tileDescriptors.push({ ox, oy, oz, tx, ty, tz });
        }
      }
    }

    const concurrency = Math.max(
      1,
      Math.min(
        typeof window !== 'undefined' ? 1 : 4,
        Math.floor((globalThis.navigator?.hardwareConcurrency ?? 4) / 2) || 1
      )
    );

    const rasterStartedAt = performance.now();
    const tileResults = await runWithConcurrency(tileDescriptors, concurrency, async ({ ox, oy, oz, tx, ty, tz }) => {
      const tileVoxelCount = tx * ty * tz;
      const bitWords = Math.ceil(tileVoxelCount / 32);
      const bitBuf = new StorageBufferAttribute(new Uint32Array(bitWords), 1);
      const triBuf = new StorageBufferAttribute(new Uint32Array(tileVoxelCount), 1);
      const distInit = new Uint32Array(tileVoxelCount);
      distInit.fill(0x7f800000);
      const distBuf = new StorageBufferAttribute(distInit, 1);

      await renderer.computeAsync(
        this._clearWGSL({
          bits: storage(bitBuf, 'atomic<u32>', bitBuf.count),
          tris: storage(triBuf, 'u32', triBuf.count),
          dists: storage(distBuf, 'atomic<u32>', distBuf.count),
          id: instanceIndex,
        }).compute(Math.max(bitWords, tileVoxelCount))
      );

      const tileMin = new THREE.Vector3(
        bbox.min.x + ox * voxelSize,
        bbox.min.y + oy * voxelSize,
        bbox.min.z + oz * voxelSize
      );

      await renderer.computeAsync(
        this._rasterWGSL({
          pos: posBuf,
          ind: idxBuf,
          bits: storage(bitBuf, 'atomic<u32>', bitBuf.count),
          tris: storage(triBuf, 'u32', triBuf.count),
          dists: storage(distBuf, 'atomic<u32>', distBuf.count),
          gDim: uniform(new THREE.Vector3(tx, ty, tz)),
          bMin: uniform(tileMin),
          vSz: uniform(voxelSize),
          triId: instanceIndex,
        }).compute(this.indices.length / 3)
      );

      const [bitsBuffer, trisBuffer] = await Promise.all([
        renderer.getArrayBufferAsync(bitBuf),
        renderer.getArrayBufferAsync(triBuf),
      ]);

      const postprocessStartedAt = performance.now();
      const postprocessYieldState = createYieldState();
      const bitsCPU = new Uint32Array(bitsBuffer);
      const trisCPU = new Uint32Array(trisBuffer);
      const occupied = [];

      const v0 = new THREE.Vector3();
      const v1 = new THREE.Vector3();
      const v2 = new THREE.Vector3();
      const e0 = new THREE.Vector3();
      const e1 = new THREE.Vector3();
      const ep = new THREE.Vector3();
      const closest = new THREE.Vector3();
      const triangle = new THREE.Triangle(v0, v1, v2);
      const uv0 = new THREE.Vector2();
      const uv1 = new THREE.Vector2();
      const uv2 = new THREE.Vector2();
      const uvPoint = new THREE.Vector2();
      const sampledColor = new THREE.Color();
      const textureColor = new THREE.Color();
      const sampledAlpha = { r: 0, g: 0, b: 0, a: 1 };

      let flat = 0;
      for (let wordIndex = 0; wordIndex < bitsCPU.length; wordIndex++) {
        if ((wordIndex & 255) === 255) await maybeYieldToBrowser(postprocessYieldState, this.mainThreadPolicy);
        let word = bitsCPU[wordIndex];
        if (!word) {
          flat += 32;
          continue;
        }

        for (let bit = 0; bit < 32 && flat < tileVoxelCount; bit++, flat++) {
          if ((word & 1) === 0) {
            word >>>= 1;
            continue;
          }
          word >>>= 1;

          const rawTriangle = trisCPU[flat];
          if (!rawTriangle) continue;
          const triangleId = rawTriangle - 1;
          const materialInfo = materialInfos[this.triMats[triangleId]] ?? materialInfos[0];
          if (!materialInfo) continue;

          const localZ = (flat / (tx * ty)) | 0;
          const rem = flat - localZ * tx * ty;
          const localY = (rem / tx) | 0;
          const localX = rem - localY * tx;
          const x = ox + localX;
          const y = oy + localY;
          const z = oz + localZ;
          const globalFlat = x + y * NX + z * sliceStride;

          let paletteId = materialInfo.constantPaletteId;
          if (!paletteId) {
            const cx = bbox.min.x + (x + 0.5) * voxelSize;
            const cy = bbox.min.y + (y + 0.5) * voxelSize;
            const cz = bbox.min.z + (z + 0.5) * voxelSize;

            v0.fromArray(this.positions, this.indices[triangleId * 3] * 3);
            v1.fromArray(this.positions, this.indices[triangleId * 3 + 1] * 3);
            v2.fromArray(this.positions, this.indices[triangleId * 3 + 2] * 3);

            uv0.fromArray(this.uvs, this.indices[triangleId * 3] * 2);
            uv1.fromArray(this.uvs, this.indices[triangleId * 3 + 1] * 2);
            uv2.fromArray(this.uvs, this.indices[triangleId * 3 + 2] * 2);

            e0.subVectors(v1, v0);
            e1.subVectors(v2, v0);
            ep.set(cx, cy, cz).sub(v0);

            const d00 = e0.dot(e0);
            const d01 = e0.dot(e1);
            const d11 = e1.dot(e1);
            const d20 = ep.dot(e0);
            const d21 = ep.dot(e1);
            const denom = d00 * d11 - d01 * d01;

            let vv = 0;
            let ww = 0;
            let uu = 1;

            if (Math.abs(denom) > 1e-12) {
              const inv = 1 / denom;
              vv = (d11 * d20 - d01 * d21) * inv;
              ww = (d00 * d21 - d01 * d20) * inv;
              uu = 1 - vv - ww;
            }

            if (uu < 0 || vv < 0 || ww < 0) {
              triangle.closestPointToPoint(closest.copy(ep).add(v0), closest);
              ep.copy(closest).sub(v0);
              const d20c = ep.dot(e0);
              const d21c = ep.dot(e1);
              const safeDenom = Math.abs(denom) > 1e-12 ? denom : 1;
              const inv = 1 / safeDenom;
              vv = (d11 * d20c - d01 * d21c) * inv;
              ww = (d00 * d21c - d01 * d20c) * inv;
              uu = 1 - vv - ww;
            }

            uvPoint.set(
              uu * uv0.x + vv * uv1.x + ww * uv2.x,
              uu * uv0.y + vv * uv1.y + ww * uv2.y
            );

            sampledColor.r = materialInfo.baseR;
            sampledColor.g = materialInfo.baseG;
            sampledColor.b = materialInfo.baseB;

            for (const sampler of materialInfo.colorSamplers) {
              sampler(uvPoint, false, textureColor);
              sampledColor.r *= textureColor.r;
              sampledColor.g *= textureColor.g;
              sampledColor.b *= textureColor.b;
            }

            let alpha = materialInfo.opacity;
            if (materialInfo.alphaSampler) {
              materialInfo.alphaSampler(uvPoint, true, sampledAlpha);
              alpha *= sampledAlpha.a;
            }
            if (alpha < 0.5) continue;

            paletteId = nearestPaletteId(
              sampledColor.r,
              sampledColor.g,
              sampledColor.b,
              this.palette,
              this.paletteCount
            );
          }

          paletteIds[globalFlat] = paletteId;
          occupied.push(globalFlat);
        }
      }

      return {
        occupied,
        postprocessMs: performance.now() - postprocessStartedAt,
      };
    });

    const rasterWallMs = performance.now() - rasterStartedAt;
    let postprocessMs = 0;
    let occupiedCount = 0;
    for (const tile of tileResults) {
      postprocessMs += tile.postprocessMs;
      occupiedCount += tile.occupied.length;
    }

    if (!occupiedCount) {
      this.voxelCount = 0;
      this.voxelMesh = createEmptyVoxelMesh();
      this._voxelGrid = null;
      return {
        rasterMs: Math.max(0, rasterWallMs - postprocessMs),
        postprocessMs,
        meshMs: 0,
        gridExportMs: 0,
      };
    }

    const occupiedIndices = new Uint32Array(occupiedCount);
    let occupiedOffset = 0;
    const mergeYieldState = createYieldState();
    for (const tile of tileResults) {
      occupiedIndices.set(tile.occupied, occupiedOffset);
      occupiedOffset += tile.occupied.length;
      await maybeYieldToBrowser(mergeYieldState, this.mainThreadPolicy);
    }
    this.voxelCount = occupiedIndices.length;

    const meshStartedAt = performance.now();
    const totalFaces = await this.#countVisibleFaces(occupiedIndices, paletteIds, NX, NY, NZ);
    this.voxelMesh = await this.#buildVoxelMesh(occupiedIndices, paletteIds, totalFaces, NX, NY, NZ, voxelSize, bbox);
    const meshMs = performance.now() - meshStartedAt;

    let gridExportMs = 0;
    if (this.needGrid) {
      const gridStartedAt = performance.now();
      this._voxelGrid = await this.#buildVoxelGrid(occupiedIndices, paletteIds, voxelSize);
      gridExportMs = performance.now() - gridStartedAt;
    } else {
      this._voxelGrid = null;
    }

    return {
      rasterMs: Math.max(0, rasterWallMs - postprocessMs),
      postprocessMs,
      meshMs,
      gridExportMs,
    };
  }

  async #countVisibleFaces(occupiedIndices, paletteIds, NX, NY, NZ) {
    const sliceStride = NX * NY;
    let faceCount = 0;
    const yieldState = createYieldState();

    for (let i = 0; i < occupiedIndices.length; i++) {
      if ((i & 4095) === 4095) await maybeYieldToBrowser(yieldState, this.mainThreadPolicy);
      const flat = occupiedIndices[i];
      const x = flat % NX;
      const yz = (flat - x) / NX;
      const y = yz % NY;
      const z = (yz - y) / NY;

      if (x === 0 || paletteIds[flat - 1] === 0) faceCount++;
      if (x === NX - 1 || paletteIds[flat + 1] === 0) faceCount++;
      if (y === 0 || paletteIds[flat - NX] === 0) faceCount++;
      if (y === NY - 1 || paletteIds[flat + NX] === 0) faceCount++;
      if (z === 0 || paletteIds[flat - sliceStride] === 0) faceCount++;
      if (z === NZ - 1 || paletteIds[flat + sliceStride] === 0) faceCount++;
    }

    return faceCount;
  }

  async #buildVoxelMesh(occupiedIndices, paletteIds, totalFaces, NX, NY, NZ, voxelSize, bbox) {
    if (!totalFaces) return createEmptyVoxelMesh();

    const totalVertices = totalFaces * 4;
    if (totalVertices <= MAX_VERTICES_PER_MESH) {
      return this.#buildMeshFromRange(occupiedIndices, 0, occupiedIndices.length, paletteIds, NX, NY, NZ, voxelSize, bbox);
    }

    const chunkCount = Math.ceil(totalVertices / MAX_VERTICES_PER_MESH);
    const voxelsPerChunk = Math.ceil(occupiedIndices.length / chunkCount);
    const group = new THREE.Group();

    for (let chunk = 0; chunk < chunkCount; chunk++) {
      const start = chunk * voxelsPerChunk;
      const end = Math.min(start + voxelsPerChunk, occupiedIndices.length);
      const mesh = await this.#buildMeshFromRange(occupiedIndices, start, end, paletteIds, NX, NY, NZ, voxelSize, bbox);
      if (mesh) group.add(mesh);
      await nextFrame();
    }

    return group.children.length ? group : createEmptyVoxelMesh();
  }

  async #buildMeshFromRange(occupiedIndices, start, end, paletteIds, NX, NY, NZ, voxelSize, bbox) {
    const sliceStride = NX * NY;
    let faceCount = 0;
    const countYieldState = createYieldState();

    for (let i = start; i < end; i++) {
      if (((i - start) & 4095) === 4095) await maybeYieldToBrowser(countYieldState, this.mainThreadPolicy);
      const flat = occupiedIndices[i];
      const x = flat % NX;
      const yz = (flat - x) / NX;
      const y = yz % NY;
      const z = (yz - y) / NY;

      if (x === 0 || paletteIds[flat - 1] === 0) faceCount++;
      if (x === NX - 1 || paletteIds[flat + 1] === 0) faceCount++;
      if (y === 0 || paletteIds[flat - NX] === 0) faceCount++;
      if (y === NY - 1 || paletteIds[flat + NX] === 0) faceCount++;
      if (z === 0 || paletteIds[flat - sliceStride] === 0) faceCount++;
      if (z === NZ - 1 || paletteIds[flat + sliceStride] === 0) faceCount++;
    }

    if (!faceCount) return null;

    const vertexCount = faceCount * 4;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Uint8Array(vertexCount * 4);
    const normals = new Int8Array(vertexCount * 3);
    const indices = vertexCount > 65535 ? new Uint32Array(faceCount * 6) : new Uint16Array(faceCount * 6);

    let vertexOffset = 0;
    let indexOffset = 0;
    let vertexIndex = 0;
    const fillYieldState = createYieldState();

    for (let i = start; i < end; i++) {
      if (((i - start) & 2047) === 2047) await maybeYieldToBrowser(fillYieldState, this.mainThreadPolicy);
      const flat = occupiedIndices[i];
      const paletteBase = (paletteIds[flat] - 1) * 3;
      if (paletteBase < 0) continue;

      const x = flat % NX;
      const yz = (flat - x) / NX;
      const y = yz % NY;
      const z = (yz - y) / NY;

      const baseX = bbox.min.x + x * voxelSize;
      const baseY = bbox.min.y + y * voxelSize;
      const baseZ = bbox.min.z + z * voxelSize;

      const colorR = clampByte(this.palette[paletteBase]);
      const colorG = clampByte(this.palette[paletteBase + 1]);
      const colorB = clampByte(this.palette[paletteBase + 2]);

      for (const face of CUBE_FACES) {
        const nx = x + face.dir[0];
        const ny = y + face.dir[1];
        const nz = z + face.dir[2];
        if (
          nx >= 0 && nx < NX
          && ny >= 0 && ny < NY
          && nz >= 0 && nz < NZ
          && paletteIds[nx + ny * NX + nz * sliceStride] !== 0
        ) {
          continue;
        }

        for (let vertex = 0; vertex < 4; vertex++) {
          const vertexBase = vertexOffset * 3;
          const colorBase = vertexOffset * 4;
          const point = face.vertices[vertex];

          positions[vertexBase] = baseX + point[0] * voxelSize;
          positions[vertexBase + 1] = baseY + point[1] * voxelSize;
          positions[vertexBase + 2] = baseZ + point[2] * voxelSize;

          normals[vertexBase] = face.normal[0];
          normals[vertexBase + 1] = face.normal[1];
          normals[vertexBase + 2] = face.normal[2];

          colors[colorBase] = colorR;
          colors[colorBase + 1] = colorG;
          colors[colorBase + 2] = colorB;
          colors[colorBase + 3] = 255;
          vertexOffset++;
        }

        indices[indexOffset++] = vertexIndex;
        indices[indexOffset++] = vertexIndex + 1;
        indices[indexOffset++] = vertexIndex + 2;
        indices[indexOffset++] = vertexIndex;
        indices[indexOffset++] = vertexIndex + 2;
        indices[indexOffset++] = vertexIndex + 3;
        vertexIndex += 4;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3, true));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        toneMapped: false,
        side: THREE.FrontSide,
      })
    );
    mesh.frustumCulled = true;
    return mesh;
  }

  async #buildVoxelGrid(occupiedIndices, paletteIds, voxelSize) {
    const total = this.totalGridVoxelCount;
    const voxelColors = new Float32Array(total * 4);
    const voxelCounts = new Uint32Array(total);
    const yieldState = createYieldState();

    for (let i = 0; i < occupiedIndices.length; i++) {
      if ((i & 4095) === 4095) await maybeYieldToBrowser(yieldState, this.mainThreadPolicy);
      const flat = occupiedIndices[i];
      const paletteBase = (paletteIds[flat] - 1) * 3;
      if (paletteBase < 0) continue;

      voxelCounts[flat] = 1;
      voxelColors[flat * 4] = Math.min(1, Math.max(0, linearToSrgbChannel(this.palette[paletteBase])));
      voxelColors[flat * 4 + 1] = Math.min(1, Math.max(0, linearToSrgbChannel(this.palette[paletteBase + 1])));
      voxelColors[flat * 4 + 2] = Math.min(1, Math.max(0, linearToSrgbChannel(this.palette[paletteBase + 2])));
      voxelColors[flat * 4 + 3] = 1;
    }

    return {
      colorSpace: 'srgb',
      gridSize: this.grid.clone(),
      unit: new THREE.Vector3(voxelSize, voxelSize, voxelSize),
      bbox: this.bbox.clone(),
      voxelColors,
      voxelCounts,
    };
  }

  async #bakeAndMerge(root) {
    const meshes = [];
    root.traverse(object => {
      if (object.isMesh && object.geometry?.getAttribute('position')) meshes.push(object);
    });

    const positionChunks = [];
    const uvChunks = [];
    const indices = [];
    const triMats = [];
    const materials = [];
    const materialMap = new Map();
    let totalVertexCount = 0;
    const maxPaletteSamples = 4096;
    const paletteSamples = new Float32Array(maxPaletteSamples * 3);
    let paletteSampleCount = 0;
    let paletteSeen = 0;
    let paletteState = 0x51f2d3a7;

    const nextPaletteSlot = (limit) => {
      paletteState = (1664525 * paletteState + 1013904223) >>> 0;
      return Math.floor((paletteState / 0x100000000) * limit);
    };

    const recordPaletteSample = (r, g, b) => {
      const sampleIndex = paletteSeen++;
      if (sampleIndex < maxPaletteSamples) {
        const base = sampleIndex * 3;
        paletteSamples[base] = r;
        paletteSamples[base + 1] = g;
        paletteSamples[base + 2] = b;
        paletteSampleCount = sampleIndex + 1;
        return;
      }

      const slot = nextPaletteSlot(sampleIndex + 1);
      if (slot >= maxPaletteSamples) return;
      const base = slot * 3;
      paletteSamples[base] = r;
      paletteSamples[base + 1] = g;
      paletteSamples[base + 2] = b;
    };

    const meshYieldState = createYieldState();
    for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
      await maybeYieldToBrowser(meshYieldState, this.mainThreadPolicy);
      const object = meshes[meshIndex];
      object.updateWorldMatrix(true, false);
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      const positionAttribute = geometry.getAttribute('position');
      if (!positionAttribute) continue;
      const indexArray = geometry.index ? geometry.index.array : null;

      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) {
        if (material && !materialMap.has(material)) {
          materialMap.set(material, materials.length);
          materials.push(material);
          for (const key of ['map', 'emissiveMap', 'alphaMap']) {
            const texture = material[key];
            if (texture && texture.isTexture) {
              texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
              texture.needsUpdate = true;
            }
          }
        }
      }

      const groups = geometry.groups.length
        ? geometry.groups
        : [{ start: 0, count: indexArray ? indexArray.length : positionAttribute.count, materialIndex: 0 }];
      const uvAttribute = geometry.getAttribute('uv');
      const uvPoint = new THREE.Vector2();
      const sampled = new THREE.Color();
      const texColor = new THREE.Color();
      const sampleYieldState = createYieldState();

      for (const group of groups) {
        const material = meshMaterials[group.materialIndex];
        if (!material) continue;

        const sampleBudget = Math.min(group.count, 192);
        if (!sampleBudget) continue;

        if (!uvAttribute && !material.emissive && !material.emissiveMap) {
          recordPaletteSample(
            material.color?.r ?? 1,
            material.color?.g ?? 1,
            material.color?.b ?? 1
          );
          continue;
        }

        const sampleStep = Math.max(1, Math.floor(group.count / sampleBudget));
        for (let groupIndex = group.start; groupIndex < group.start + group.count; groupIndex += sampleStep) {
          if (((groupIndex - group.start) & 255) === 255) await maybeYieldToBrowser(sampleYieldState, this.mainThreadPolicy);
          const vertexIndex = indexArray ? indexArray[groupIndex] : groupIndex;
          sampled.r = material.color?.r ?? 1;
          sampled.g = material.color?.g ?? 1;
          sampled.b = material.color?.b ?? 1;

          if (material.emissive) {
            sampled.r += material.emissive.r;
            sampled.g += material.emissive.g;
            sampled.b += material.emissive.b;
          }

          if (uvAttribute) {
            uvPoint.set(uvAttribute.getX(vertexIndex), uvAttribute.getY(vertexIndex));
            for (const texture of allTextures(material)) {
              const sampler = getSampler(texture);
              if (!sampler) continue;
              sampler(uvPoint, false, texColor);
              sampled.r *= texColor.r;
              sampled.g *= texColor.g;
              sampled.b *= texColor.b;
            }
          }

          if (
            Number.isFinite(sampled.r)
            && Number.isFinite(sampled.g)
            && Number.isFinite(sampled.b)
          ) {
            recordPaletteSample(
              Math.min(1, Math.max(0, sampled.r)),
              Math.min(1, Math.max(0, sampled.g)),
              Math.min(1, Math.max(0, sampled.b))
            );
          }
        }
      }

      positionChunks.push(positionAttribute.array);

      if (uvAttribute?.array) {
        uvChunks.push(uvAttribute.array);
      } else {
        uvChunks.push(new Float32Array(positionAttribute.count * 2));
      }

      for (const group of groups) {
        const material = meshMaterials[group.materialIndex];
        if (!material) continue;

        const globalMaterialIndex = materialMap.get(material);
        for (let i = group.start; i < group.start + group.count; i += 3) {
          if (((i - group.start) & 1023) === 1023) await maybeYieldToBrowser(sampleYieldState, this.mainThreadPolicy);
          const a = indexArray ? indexArray[i] : i;
          const b = indexArray ? indexArray[i + 1] : i + 1;
          const c = indexArray ? indexArray[i + 2] : i + 2;
          indices.push(totalVertexCount + a, totalVertexCount + b, totalVertexCount + c);
          triMats.push(globalMaterialIndex);
        }
      }

      totalVertexCount += positionAttribute.count;
      geometry.dispose();
    }

    if (!positionChunks.length) {
      return {
        positions: new Float32Array(),
        uvs: new Float32Array(),
        indices: new Uint32Array(),
        triMats: new Uint32Array(),
        palette: new Float32Array(),
        materials: [],
      };
    }

    const positions = new Float32Array(totalVertexCount * 3);
    const uvs = new Float32Array(totalVertexCount * 2);
    let positionOffset = 0;
    let uvOffset = 0;
    const copyYieldState = createYieldState();

    for (let i = 0; i < positionChunks.length; i++) {
      await maybeYieldToBrowser(copyYieldState, this.mainThreadPolicy);
      positions.set(positionChunks[i], positionOffset);
      uvs.set(uvChunks[i], uvOffset);
      positionOffset += positionChunks[i].length;
      uvOffset += uvChunks[i].length;
    }

    return {
      positions,
      uvs,
      indices: new Uint32Array(indices),
      triMats: new Uint32Array(triMats),
      palette: paletteSampleCount
        ? kMeansPalette(paletteSamples.subarray(0, paletteSampleCount * 3), this.paletteSize).palette
        : new Float32Array([1, 1, 1]),
      materials,
    };
  }
}
