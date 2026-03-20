import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { voxelizeModel, WEBGPU_WORKER_POOL_SIZE } from './voxelize-model.js';

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(samples, method) {
  return {
    method,
    totalMs: average(samples.map(sample => sample.totalMs)),
    rasterMs: average(samples.map(sample => sample.rasterMs)),
    postprocessMs: average(samples.map(sample => sample.postprocessMs)),
    meshMs: average(samples.map(sample => sample.meshMs)),
    bakeMs: average(samples.map(sample => sample.bakeMs)),
    voxelCount: samples[0]?.voxelCount ?? 0,
    chunkCount: samples[0]?.chunkCount ?? 0,
  };
}

function summarizeParallel(samples, method, jobs) {
  return {
    method,
    jobs,
    batchMs: average(samples.map(sample => sample.batchMs)),
    perTileMs: average(samples.map(sample => sample.batchMs / jobs)),
    voxelCount: average(samples.map(sample => sample.voxelCount)),
    chunkCount: average(samples.map(sample => sample.chunkCount)),
  };
}

function chunkCountOf(mesh) {
  if (!mesh) return 0;
  return mesh.isGroup ? mesh.children.length : 1;
}

function assertRenderableVoxelResult(result, method) {
  const chunkCount = chunkCountOf(result?.voxelMesh);
  if ((result?.voxelCount ?? 0) > 0 && chunkCount === 0) {
    throw new Error(`${method} produced ${result.voxelCount} voxels but no renderable chunks`);
  }
}

function disposeObject3D(root) {
  if (!root) return;
  root.traverse?.((node) => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) {
      for (const material of node.material) material?.dispose?.();
    } else {
      node.material?.dispose?.();
    }
  });
  root.removeFromParent?.();
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

async function createRenderer() {
  const renderer = new WebGPURenderer({ antialias: false, forceWebGL: false });
  renderer.setSize(1, 1, false);
  renderer.domElement.style.position = 'fixed';
  renderer.domElement.style.left = '-9999px';
  renderer.domElement.style.top = '-9999px';
  if (THREE.SRGBColorSpace !== undefined && 'outputColorSpace' in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  return renderer;
}

async function benchmarkMethod({ renderer, method, makeModel, resolution, runs }) {
  const samples = [];

  for (let iteration = 0; iteration < runs + 1; iteration++) {
    const model = makeModel();
    const startedAt = performance.now();
    const result = await voxelizeModel({
      model,
      renderer,
      resolution,
      needGrid: false,
      method,
      renderMode: method === 'webgpu' ? 'instances' : 'mesh',
    });
    const elapsed = performance.now() - startedAt;

    if (result.stats?.fallbackReason) {
      throw new Error(`${method} benchmark fell back: ${result.stats.fallbackReason}`);
    }
    assertRenderableVoxelResult(result, method);

    if (iteration > 0) {
      samples.push({
        totalMs: elapsed,
        rasterMs: result.stats?.rasterMs ?? 0,
        postprocessMs: result.stats?.postprocessMs ?? 0,
        meshMs: result.stats?.meshMs ?? 0,
        bakeMs: result.stats?.bakeMs ?? 0,
        voxelCount: result.voxelCount ?? 0,
        chunkCount: chunkCountOf(result.voxelMesh),
      });
    }

    disposeObject3D(result.voxelMesh);
    disposeObject3D(model);
  }

  return summarize(samples, method);
}

async function benchmarkMethodParallel({ renderer, method, makeModel, resolution, runs, jobs }) {
  const samples = [];

  for (let iteration = 0; iteration < runs + 1; iteration++) {
    const models = Array.from({ length: jobs }, () => makeModel());
    const startedAt = performance.now();
    const results = await Promise.all(
      models.map((model) => voxelizeModel({
        model,
        renderer,
        resolution,
        needGrid: false,
        method,
        renderMode: method === 'webgpu' ? 'instances' : 'mesh',
      }))
    );
    const elapsed = performance.now() - startedAt;

    for (const result of results) {
      if (result.stats?.fallbackReason) {
        throw new Error(`${method} benchmark fell back: ${result.stats.fallbackReason}`);
      }
      assertRenderableVoxelResult(result, method);
    }

    if (iteration > 0) {
      samples.push({
        batchMs: elapsed,
        voxelCount: results.reduce((sum, result) => sum + (result.voxelCount ?? 0), 0),
        chunkCount: results.reduce((sum, result) => sum + chunkCountOf(result.voxelMesh), 0),
      });
    }

    for (const result of results) disposeObject3D(result.voxelMesh);
    for (const model of models) disposeObject3D(model);
  }

  return summarizeParallel(samples, method, jobs);
}

async function benchmarkScenario({ label, renderer, makeModel, resolution, runs }) {
  const js = await benchmarkMethod({
    renderer,
    method: '2.5d-scan',
    makeModel,
    resolution,
    runs,
  });

  const webgpu = await benchmarkMethod({
    renderer,
    method: 'webgpu',
    makeModel,
    resolution,
    runs,
  });

  return {
    label,
    resolution,
    js,
    webgpu,
    speedup: {
      total: js.totalMs / webgpu.totalMs,
      raster: js.rasterMs / webgpu.rasterMs,
    },
  };
}

async function benchmarkParallelScenario({ label, renderer, makeModel, resolution, runs, jobs }) {
  const js = await benchmarkMethodParallel({
    renderer,
    method: '2.5d-scan',
    makeModel,
    resolution,
    runs,
    jobs,
  });

  const webgpu = await benchmarkMethodParallel({
    renderer,
    method: 'webgpu',
    makeModel,
    resolution,
    runs,
    jobs,
  });

  return {
    label,
    resolution,
    jobs,
    js,
    webgpu,
    speedup: {
      batch: js.batchMs / webgpu.batchMs,
      perTile: js.perTileMs / webgpu.perTileMs,
    },
  };
}

export async function runWebGpuBenchmark(options = {}) {
  if (!navigator.gpu) {
    throw new Error('navigator.gpu is unavailable in this browser');
  }

  const {
    terrainRuns = 2,
    denseRuns = 2,
    parallelTerrainRuns = 2,
    terrainResolution = 160,
    denseResolution = 192,
    terrainSize = 12,
    parallelTerrainJobs = 4,
    denseSegments = 640,
    denseSize = 24,
  } = options;

  const renderer = await createRenderer();
  try {
    const fragmented = await benchmarkScenario({
      label: 'fragmented terrain',
      renderer,
      makeModel: () => makeTerrainModel(terrainSize),
      resolution: terrainResolution,
      runs: terrainRuns,
    });

    const dense = await benchmarkScenario({
      label: 'dense earth-like surface',
      renderer,
      makeModel: () => makeDenseSurfaceModel(denseSegments, denseSize),
      resolution: denseResolution,
      runs: denseRuns,
    });

    const fragmentedParallel = await benchmarkParallelScenario({
      label: 'fragmented terrain parallel fill',
      renderer,
      makeModel: () => makeTerrainModel(terrainSize),
      resolution: terrainResolution,
      runs: parallelTerrainRuns,
      jobs: parallelTerrainJobs,
    });

    return {
      userAgent: navigator.userAgent,
      webgpuPoolSize: WEBGPU_WORKER_POOL_SIZE,
      fragmented,
      dense,
      fragmentedParallel,
    };
  } finally {
    renderer.dispose?.();
    renderer.domElement?.remove?.();
  }
}
