import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { serializeModel } from '../src/voxelize-model.js';
import { WorkerVoxelizer } from '../src/voxelizer.worker.js';
import { loadWithConcurrency } from '../src/loadGltfBatch.js';

const realFetch = globalThis.fetch?.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol === 'file:') {
    const buffer = await fs.readFile(fileURLToPath(url));
    return new Response(buffer, { headers: { 'Content-Type': 'application/wasm' } });
  }
  if (!realFetch) throw new Error('No fetch available for benchmark');
  return realFetch(input, init);
};

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fmtMs(value) {
  return `${value.toFixed(1)} ms`;
}

function makeTerrainModel(size = 12) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0x8ec5ff });

  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const height = 0.4 + ((Math.sin(x * 0.55) + Math.cos(z * 0.45) + 2) * 0.6);
      const geometry = new THREE.BoxGeometry(0.92, height, 0.92);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x - size * 0.5, height * 0.5, z - size * 0.5);
      group.add(mesh);
    }
  }

  group.updateMatrixWorld(true);
  return group;
}

function makeDenseSurfaceModel(segments = 640, size = 24) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0x8ec5ff });
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y =
      Math.sin(x * 0.35) * 1.4 +
      Math.cos(z * 0.30) * 1.1 +
      Math.sin((x + z) * 0.18) * 0.9;
    pos.setY(i, y);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  group.add(new THREE.Mesh(geometry, material));
  group.updateMatrixWorld(true);
  return group;
}

function getVoxelSize(modelData, resolution) {
  const min = modelData.bbox.min;
  const max = modelData.bbox.max;
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  return Math.max(sx, sy, sz) / resolution;
}

function runSerializeBench(model, options, runs = 5) {
  const durations = [];
  for (let i = 0; i < runs + 1; i++) {
    const startedAt = performance.now();
    serializeModel(model, options);
    const elapsed = performance.now() - startedAt;
    if (i === 0) continue;
    durations.push(elapsed);
  }
  return average(durations);
}

async function runVoxelBench(modelData, resolution, { method = '2.5d-scan', hitStoreMode = 'auto' } = {}, runs = 3) {
  const timings = [];

  for (let i = 0; i < runs + 1; i++) {
    const voxelizer = new WorkerVoxelizer();
    const startedAt = performance.now();
    const result = await voxelizer.init({
      modelData,
      voxelSize: getVoxelSize(modelData, resolution),
      method,
      hitStoreMode,
      needGrid: false,
    });
    const elapsed = performance.now() - startedAt;

    if (i === 0) continue;

    timings.push({
      totalMs: elapsed,
      rasterMs: result.stats.rasterMs,
      postprocessMs: result.stats.postprocessMs ?? 0,
      accumulateMs: result.stats.accumulateMs ?? 0,
      paletteMs: result.stats.paletteMs ?? 0,
      meshMs: result.stats.meshMs,
      bakeMs: result.stats.bakeMs,
      wasmCalls: result.stats.wasmCalls ?? 0,
      batchCount: result.stats.batchCount ?? 0,
      voxelCount: result.voxelCount,
      chunkCount: result.geometries.length,
      method: result.stats.method ?? method,
      hitStoreMode: result.stats.hitStoreMode,
    });
  }

  return {
    totalMs: average(timings.map(item => item.totalMs)),
    rasterMs: average(timings.map(item => item.rasterMs)),
    postprocessMs: average(timings.map(item => item.postprocessMs)),
    accumulateMs: average(timings.map(item => item.accumulateMs)),
    paletteMs: average(timings.map(item => item.paletteMs)),
    meshMs: average(timings.map(item => item.meshMs)),
    bakeMs: average(timings.map(item => item.bakeMs)),
    wasmCalls: average(timings.map(item => item.wasmCalls)),
    batchCount: average(timings.map(item => item.batchCount)),
    voxelCount: timings[0]?.voxelCount ?? 0,
    chunkCount: timings[0]?.chunkCount ?? 0,
    method: timings[0]?.method ?? method,
    hitStoreMode: timings[0]?.hitStoreMode ?? hitStoreMode,
  };
}

async function runLoaderBench(taskCount = 48, latencyMs = 35, concurrency = 1, runs = 3) {
  const items = Array.from({ length: taskCount }, (_, index) => index);
  const durations = [];

  for (let i = 0; i < runs + 1; i++) {
    const startedAt = performance.now();
    await loadWithConcurrency(items, async (index) => {
      const jitter = (index % 5) * 3;
      await new Promise(resolve => setTimeout(resolve, latencyMs + jitter));
      return index;
    }, concurrency);
    const elapsed = performance.now() - startedAt;
    if (i === 0) continue;
    durations.push(elapsed);
  }

  return average(durations);
}

async function main() {
  const model = makeTerrainModel();
  const denseModel = makeDenseSurfaceModel();
  const serializeUncached = runSerializeBench(model, { cache: false });
  serializeModel(model, { cache: true });
  const serializeCached = runSerializeBench(model, { cache: true });
  const serialized = serializeModel(model, { cache: true });
  const denseSerialized = serializeModel(denseModel, { cache: true });
  const resolution = 160;
  const denseResolution = 192;

  console.log('Serialization benchmark');
  console.log(`Uncached serialize: ${fmtMs(serializeUncached)}`);
  console.log(`Warm cached serialize: ${fmtMs(serializeCached)}`);
  console.log(`Serialize speedup on rebuilds: ${(serializeUncached / serializeCached).toFixed(2)}x`);
  console.log('');

  console.log('Voxel benchmark');
  console.log(`Synthetic terrain: ${model.children.length} meshes at resolution ${resolution}`);

  const sparse = await runVoxelBench(serialized, resolution, { method: '2.5d-scan', hitStoreMode: 'sparse' });
  const auto = await runVoxelBench(serialized, resolution, { method: '2.5d-scan', hitStoreMode: 'auto' });
  const rust = await runVoxelBench(serialized, resolution, { method: 'rust-wasm' });

  console.log(`Legacy sparse store: total ${fmtMs(sparse.totalMs)}, raster ${fmtMs(sparse.rasterMs)}, mesh ${fmtMs(sparse.meshMs)}`);
  console.log(`Adaptive hit store: total ${fmtMs(auto.totalMs)}, raster ${fmtMs(auto.rasterMs)}, mesh ${fmtMs(auto.meshMs)}`);
  console.log(`Rust WASM 2.5D: total ${fmtMs(rust.totalMs)}, raster ${fmtMs(rust.rasterMs)}, post ${fmtMs(rust.postprocessMs)}, mesh ${fmtMs(rust.meshMs)}, calls ${rust.wasmCalls.toFixed(1)}`);
  console.log(`Voxel speedup: ${(sparse.totalMs / auto.totalMs).toFixed(2)}x total, ${(sparse.rasterMs / auto.rasterMs).toFixed(2)}x raster`);
  console.log(`Rust vs adaptive JS: ${(auto.totalMs / rust.totalMs).toFixed(2)}x total, ${(auto.rasterMs / rust.rasterMs).toFixed(2)}x raster`);
  console.log(`Voxel output: ${auto.voxelCount.toLocaleString()} voxels across ${auto.chunkCount} chunk meshes`);
  console.log('');

  console.log('Dense surface benchmark');
  console.log(`Earth-like terrain mesh: ${(denseModel.children[0]?.geometry?.index?.count ?? 0) / 3 | 0} triangles at resolution ${denseResolution}`);
  const denseJs = await runVoxelBench(denseSerialized, denseResolution, { method: '2.5d-scan' }, 2);
  const denseRust = await runVoxelBench(denseSerialized, denseResolution, { method: 'rust-wasm' }, 2);
  console.log(`Adaptive JS 2.5D: total ${fmtMs(denseJs.totalMs)}, raster ${fmtMs(denseJs.rasterMs)}, mesh ${fmtMs(denseJs.meshMs)}`);
  console.log(`Rust WASM 2.5D: total ${fmtMs(denseRust.totalMs)}, raster ${fmtMs(denseRust.rasterMs)}, mesh ${fmtMs(denseRust.meshMs)}, calls ${denseRust.wasmCalls.toFixed(1)}`);
  console.log(`Rust earth-surface speedup: ${(denseJs.totalMs / denseRust.totalMs).toFixed(2)}x total, ${(denseJs.rasterMs / denseRust.rasterMs).toFixed(2)}x raster`);
  console.log(`Dense output: ${denseRust.voxelCount.toLocaleString()} voxels across ${denseRust.chunkCount} chunk meshes`);
  console.log('');

  console.log('Tile loading benchmark');
  const sequential = await runLoaderBench(48, 35, 1);
  const parallel = await runLoaderBench(48, 35, 8);
  console.log(`Synthetic sequential load: ${fmtMs(sequential)}`);
  console.log(`Synthetic parallel load (x8): ${fmtMs(parallel)}`);
  console.log(`Load speedup: ${(sequential / parallel).toFixed(2)}x`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
