import * as THREE from 'three';

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
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

const SERIALIZED_MODEL_CACHE = new WeakMap();

function clonePlain(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function cloneSerializedModel(template) {
  return {
    meshes: template.meshes.map(mesh => ({
      geometry: {
        attributes: Object.fromEntries(
          Object.entries(mesh.geometry.attributes).map(([name, attr]) => [
            name,
            {
              array: new attr.array.constructor(attr.array),
              itemSize: attr.itemSize,
            },
          ])
        ),
        groups: clonePlain(mesh.geometry.groups),
        index: mesh.geometry.index
          ? { array: new mesh.geometry.index.array.constructor(mesh.geometry.index.array) }
          : null,
      },
      materials: mesh.materials.slice(),
      matrixWorld: mesh.matrixWorld.slice(),
    })),
    materials: clonePlain(template.materials),
    imageDatas: template.imageDatas.map(([uuid, imageData]) => [
      uuid,
      {
        data: new Uint8ClampedArray(imageData.data),
        width: imageData.width,
        height: imageData.height,
      },
    ]),
    bbox: {
      min: template.bbox.min.slice(),
      max: template.bbox.max.slice(),
    },
  };
}

/* --------------------------------------------------------------- */
/* helper – extract raw RGBA Uint8Array from any THREE texture     */
/* --------------------------------------------------------------- */
function textureToPixels(tex) {
  /* DataTexture or compressed → already has .image.data */
  if (tex.image && tex.image.data && tex.image.width && tex.image.height) {
    return new ImageData(
      new Uint8ClampedArray(tex.image.data.buffer),
      tex.image.width,
      tex.image.height
    );
  }

  /* HTMLImageElement / HTMLCanvasElement / ImageBitmap ------------- */
  const img = tex.image;
  if (!(img && img.width && img.height)) return null;

  /* draw → readPixels (works for CORS-clean images) */
  const canvas = document.createElement('canvas');
  canvas.width  = img.width;
  canvas.height = img.height;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);   // Uint8ClampedArray
  } catch {
    return null; // fall back to material color
  }
}

/* --------------------------------------------------------------- */
/* 1️⃣  serialise the model                                         */
/* --------------------------------------------------------------- */
export function serializeModel(model, { preRotateYDeg = 0, cache = true } = {}) {
  const useCache = cache && Math.abs(preRotateYDeg) <= 0.0001;
  if (useCache) {
    const cached = SERIALIZED_MODEL_CACHE.get(model);
    if (cached) return cloneSerializedModel(cached);
  }

  const meshes        = [];
  const materialStore = new Map();   // uuid → serialised material
  const imageStore    = new Map();   // uuid → ImageData

  model.updateWorldMatrix(true, true);

  model.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.isBufferGeometry) return;

    /* ── materials & textures ───────────────────────────────────── */
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat || materialStore.has(mat.uuid)) continue;

      const m = {
        uuid     : mat.uuid,
        type     : mat.type,
        color    : mat.color    ? mat.color.getHex()    : undefined,
        emissive : mat.emissive ? mat.emissive.getHex() : undefined,
      };

      for (const key of ['map', 'emissiveMap', 'alphaMap']) {
        const t = mat[key];
        if (!(t && t.isTexture)) continue;

        const idata = textureToPixels(t);
        if (idata) {
          if (!imageStore.has(t.source.uuid)) imageStore.set(t.source.uuid, idata);

          m[key] = {
            imageUuid : t.source.uuid,
            encoding  : t.encoding,
            colorSpace: t.colorSpace,
            flipY     : t.flipY,
            wrapS     : t.wrapS,
            wrapT     : t.wrapT,
            offset    : t.offset.toArray(),
            repeat    : t.repeat.toArray(),
            rotation  : t.rotation,
            center    : t.center.toArray(),
          };
        }
      }
      materialStore.set(mat.uuid, m);
    }

    /* ── geometry (preserve typed-array class) ───────────────────── */
    const g          = o.geometry;
    const attributes = {};
    for (const [name, attr] of Object.entries(g.attributes)) {
      const clone = new (attr.array.constructor)(attr.array);
      attributes[name] = { array: clone, itemSize: attr.itemSize };
    }

    meshes.push({
      geometry : {
        attributes,
        groups : g.groups,
        index  : g.index ? { array: new (g.index.array.constructor)(g.index.array) } : null
      },
      materials   : mats.map(m => m.uuid),
      matrixWorld : o.matrixWorld.toArray()
    });
  });

  const bbox = new THREE.Box3().setFromObject(model);

  /* Optional pre-bake Y rotation about the bbox center (world space) */
  if (preRotateYDeg && Math.abs(preRotateYDeg) > 0.0001) {
    const angle = preRotateYDeg * Math.PI / 180;
    const center = bbox.getCenter(new THREE.Vector3());
    const toOrigin = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
    const rot = new THREE.Matrix4().makeRotationY(angle);
    const back = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z);
    const rotAboutCenter = new THREE.Matrix4().multiplyMatrices(back, new THREE.Matrix4().multiplyMatrices(rot, toOrigin));

    for (const m of meshes) {
      const mw = new THREE.Matrix4().fromArray(m.matrixWorld);
      mw.premultiply(rotAboutCenter); // rot * original
      m.matrixWorld = mw.toArray();
    }

    // Recompute rotated bounding box efficiently by rotating the 8 original corners
    const min = bbox.min.clone();
    const max = bbox.max.clone();
    const corners = [
      new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z),
      new THREE.Vector3(min.x, max.y, min.z), new THREE.Vector3(min.x, min.y, max.z),
      new THREE.Vector3(max.x, max.y, min.z), new THREE.Vector3(max.x, min.y, max.z),
      new THREE.Vector3(min.x, max.y, max.z), new THREE.Vector3(max.x, max.y, max.z)
    ];
    const rotMat = rotAboutCenter; // already includes translations
    const rbbox = new THREE.Box3();
    for (const c of corners) { c.applyMatrix4(rotMat); rbbox.expandByPoint(c); }
    bbox.min.copy(rbbox.min); bbox.max.copy(rbbox.max);
  }

  const serialized = {
    meshes,
    materials  : Array.from(materialStore.values()),
    imageDatas : Array.from(imageStore.entries()),     // [uuid, ImageData]
    bbox       : { min: bbox.min.toArray(), max: bbox.max.toArray() }
  };

  if (useCache) {
    SERIALIZED_MODEL_CACHE.set(model, serialized);
    return cloneSerializedModel(serialized);
  }

  return serialized;
}

/* --------------------------------------------------------------- */
/* 2️⃣  send to worker, receive voxel mesh back                     */
/* --------------------------------------------------------------- */
let webGpuComputeRendererPromise = null;

function rendererSupportsWebGpuCompute(renderer) {
  return !!renderer
    && typeof renderer.computeAsync === 'function'
    && typeof renderer.getArrayBufferAsync === 'function';
}

async function getWebGpuComputeRenderer(preferredRenderer) {
  if (rendererSupportsWebGpuCompute(preferredRenderer)) return preferredRenderer;
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;

  if (!webGpuComputeRendererPromise) {
    webGpuComputeRendererPromise = (async () => {
      const { WebGPURenderer } = await import('three/webgpu');
      const renderer = new WebGPURenderer({ antialias: false, forceWebGL: false });
      renderer.setSize?.(1, 1, false);
      if (THREE.SRGBColorSpace !== undefined && 'outputColorSpace' in renderer) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
      if (renderer.init) await renderer.init();
      return renderer;
    })().catch(error => {
      webGpuComputeRendererPromise = null;
      throw error;
    });
  }

  return webGpuComputeRendererPromise;
}

function getVoxelSizeForResolution(model, resolution) {
  const bbox = new THREE.Box3().setFromObject(model);
  const size = bbox.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z) / resolution;
}

function isVoxelizationCancellationError(error) {
  const message = error?.message ?? '';
  return message === 'Voxelization cancelled' || message === 'AbortError';
}

function analyzeSerializedModel(payload) {
  let triangleCount = 0;
  let meshCount = payload?.meshes?.length ?? 0;
  let texturedMaterialCount = 0;

  for (const material of payload?.materials ?? []) {
    if (material?.map || material?.emissiveMap || material?.alphaMap) {
      texturedMaterialCount += 1;
    }
  }

  for (const mesh of payload?.meshes ?? []) {
    const indexArray = mesh?.geometry?.index?.array ?? null;
    const positionArray = mesh?.geometry?.attributes?.position?.array ?? null;
    if (indexArray?.length) {
      triangleCount += (indexArray.length / 3) | 0;
    } else if (positionArray?.length) {
      triangleCount += (positionArray.length / 9) | 0;
    }
  }

  return {
    triangleCount,
    meshCount,
    texturedMaterialCount,
  };
}

function shouldUseWebGpuForSerializedModel(payload, resolution) {
  const analysis = analyzeSerializedModel(payload);
  const { triangleCount, meshCount, texturedMaterialCount } = analysis;
  const highDetail = resolution >= 128;
  const ultraDense = triangleCount >= 20000;
  const denseSurface = triangleCount >= 12000 && meshCount <= 8;
  const texturedDense = texturedMaterialCount > 0 && triangleCount >= 10000;
  const massiveSingleMesh = meshCount <= 2 && triangleCount >= 8000;

  return {
    useWebGpu: highDetail && (ultraDense || denseSurface || texturedDense || massiveSingleMesh),
    analysis,
  };
}

function hydrateVoxelGrid(result) {
  return result.voxelGrid
    ? {
        ...result.voxelGrid,
        bbox: new THREE.Box3(
          new THREE.Vector3().fromArray(result.voxelGrid.bbox.min),
          new THREE.Vector3().fromArray(result.voxelGrid.bbox.max)
        ),
        gridSize: new THREE.Vector3(result.voxelGrid.gridSize.x, result.voxelGrid.gridSize.y, result.voxelGrid.gridSize.z),
        unit: new THREE.Vector3(result.voxelGrid.unit.x, result.voxelGrid.unit.y, result.voxelGrid.unit.z)
      }
    : null;
}

let directVoxelBaseGeometry = null;

function getDirectVoxelBaseGeometry() {
  if (!directVoxelBaseGeometry) {
    directVoxelBaseGeometry = new THREE.BoxGeometry(1, 1, 1);
  }
  return directVoxelBaseGeometry;
}

function createDirectVoxelInstanceMaterial() {
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 instanceCoord;\n'
      )
      .replace(
        '#include <begin_vertex>',
        'vec3 transformed = position + instanceCoord + vec3(0.5);'
      );
  };
  material.customProgramCacheKey = () => 'direct-voxel-instanced-cube-v2';
  return material;
}

function createDirectVoxelInstanceMesh(chunk) {
  const baseGeometry = getDirectVoxelBaseGeometry();
  const min = new THREE.Vector3(chunk.bounds.min[0], chunk.bounds.min[1], chunk.bounds.min[2]);
  const max = new THREE.Vector3(chunk.bounds.max[0], chunk.bounds.max[1], chunk.bounds.max[2]);
  const voxelSize = Math.max(1e-6, chunk.voxelSize ?? 1);
  const localExtent = new THREE.Vector3(
    (max.x - min.x) / voxelSize,
    (max.y - min.y) / voxelSize,
    (max.z - min.z) / voxelSize
  );

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = baseGeometry.index;
  geometry.setAttribute('position', baseGeometry.getAttribute('position'));
  if (baseGeometry.getAttribute('normal')) {
    geometry.setAttribute('normal', baseGeometry.getAttribute('normal'));
  }
  geometry.setAttribute('instanceCoord', new THREE.InstancedBufferAttribute(chunk.instanceCoords, 3));
  geometry.setAttribute('color', new THREE.InstancedBufferAttribute(chunk.colors8, 3, true));
  geometry.instanceCount = chunk.count;
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), localExtent.clone());
  geometry.boundingSphere = new THREE.Sphere(
    localExtent.clone().multiplyScalar(0.5),
    localExtent.length() * 0.5
  );

  const mesh = new THREE.Mesh(geometry, createDirectVoxelInstanceMaterial());
  mesh.position.copy(min);
  mesh.scale.setScalar(voxelSize);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  mesh.userData.chunkBounds = { min, max };
  mesh.userData.renderMode = 'instanced-voxels';
  return mesh;
}

async function rebuildWorkerGeometry(result, serializeStartedAt, workerPostedAt, workerCompletedAt, mainThreadPolicy = null) {
  const rebuildStartedAt = nowMs();
  if (mainThreadPolicy?.shouldPause?.()) {
    await (mainThreadPolicy.waitForIdle?.() ?? nextFrame());
  }

  if (result.instanceChunks?.length) {
    const group = new THREE.Group();
    group.userData.renderMode = 'instanced-voxels';

    for (let chunkIndex = 0; chunkIndex < result.instanceChunks.length; chunkIndex++) {
      if ((chunkIndex & 1) === 1) {
        if (mainThreadPolicy?.shouldPause?.()) {
          await (mainThreadPolicy.waitForIdle?.() ?? nextFrame());
        } else {
          await nextFrame();
        }
      }

      const chunk = result.instanceChunks[chunkIndex];
      if (!chunk?.count) continue;

      const mesh = createDirectVoxelInstanceMesh(chunk);
      group.add(mesh);
    }

    const rebuildCompletedAt = nowMs();
    return {
      voxelMesh: group,
      voxelCount: result.voxelCount,
      stats: {
        serializeMs: workerPostedAt - serializeStartedAt,
        workerMs: workerCompletedAt - workerPostedAt,
        rebuildMs: rebuildCompletedAt - rebuildStartedAt,
        totalMs: rebuildCompletedAt - serializeStartedAt,
        ...(result.stats || {}),
      },
      _voxelGrid: hydrateVoxelGrid(result),
    };
  }

  const group = new THREE.Group();
  for (let geometryIndex = 0; geometryIndex < result.geometries.length; geometryIndex++) {
    if ((geometryIndex & 1) === 1) {
      if (mainThreadPolicy?.shouldPause?.()) {
        await (mainThreadPolicy.waitForIdle?.() ?? nextFrame());
      } else {
        await nextFrame();
      }
    }

    const g = result.geometries[geometryIndex];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));

    if (g.colors8) {
      geom.setAttribute('color', new THREE.BufferAttribute(g.colors8, 4, true));
    } else if (g.colors) {
      const srcColors = g.colors;
      const vertCount = srcColors.length / 3;
      const c8 = new Uint8Array(vertCount * 4);
      for (let v = 0; v < vertCount; v++) {
        let r = srcColors[v * 3 + 0], g1 = srcColors[v * 3 + 1], b = srcColors[v * 3 + 2];
        if (!Number.isFinite(r) || !Number.isFinite(g1) || !Number.isFinite(b)) { r = g1 = b = 1; }
        c8[v * 4 + 0] = (r * 255) & 255;
        c8[v * 4 + 1] = (g1 * 255) & 255;
        c8[v * 4 + 2] = (b * 255) & 255;
        c8[v * 4 + 3] = 255;
      }
      geom.setAttribute('color', new THREE.BufferAttribute(c8, 4, true));
    } else {
      const vertCount = g.positions.length / 3;
      const c8 = new Uint8Array(vertCount * 4);
      for (let v = 0; v < vertCount; v++) { c8[v * 4 + 0] = c8[v * 4 + 1] = c8[v * 4 + 2] = c8[v * 4 + 3] = 255; }
      geom.setAttribute('color', new THREE.BufferAttribute(c8, 4, true));
    }

    if (g.normals) geom.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
    geom.setIndex(new THREE.BufferAttribute(g.indices, 1));

    if (g.bounds) {
      const min = new THREE.Vector3(g.bounds.min[0], g.bounds.min[1], g.bounds.min[2]);
      const max = new THREE.Vector3(g.bounds.max[0], g.bounds.max[1], g.bounds.max[2]);
      geom.boundingBox = new THREE.Box3(min, max);
      const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
      const radius = min.distanceTo(max) * 0.5;
      geom.boundingSphere = new THREE.Sphere(center, radius);
    } else {
      geom.computeBoundingBox?.();
      geom.computeBoundingSphere?.();
    }

    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
    );
    if (g.bounds) {
      mesh.userData.chunkBounds = {
        min: new THREE.Vector3(g.bounds.min[0], g.bounds.min[1], g.bounds.min[2]),
        max: new THREE.Vector3(g.bounds.max[0], g.bounds.max[1], g.bounds.max[2])
      };
    }
    group.add(mesh);
  }
  const rebuildCompletedAt = nowMs();

  return {
    voxelMesh: group,
    voxelCount: result.voxelCount,
    stats: {
      serializeMs: workerPostedAt - serializeStartedAt,
      workerMs: workerCompletedAt - workerPostedAt,
      rebuildMs: rebuildCompletedAt - rebuildStartedAt,
      totalMs: rebuildCompletedAt - serializeStartedAt,
      ...(result.stats || {}),
    },
    _voxelGrid: hydrateVoxelGrid(result),
  };
}

function createVoxelWorker() {
  return new Worker(
    new URL('./voxelizer.worker.js', import.meta.url),
    { type: 'module' }
  );
}

export const WEBGPU_WORKER_POOL_SIZE = 4;

let sharedWebGpuWorkerPool = null;

function createSharedWebGpuWorkerSlot(index) {
  return {
    index,
    worker: createVoxelWorker(),
    current: null,
    busy: false,
  };
}

function attachSharedWebGpuWorkerHandlers(pool, slot) {
  slot.worker.onmessage = (e) => {
    const job = slot.current;
    slot.current = null;
    slot.busy = false;
    if (!job) return;

    const workerCompletedAt = nowMs();
    const { status, result, message, stack } = e.data;
    if (job.controller.cancelled) {
      pumpSharedWebGpuWorkerQueue();
      return;
    }

    if (status === 'error') {
      console.error('[voxelizer.worker] error:', message, stack);
      job.reject(new Error(message));
      pumpSharedWebGpuWorkerQueue();
      return;
    }

    rebuildWorkerGeometry(
      result,
      job.serializeStartedAt,
      job.workerPostedAt,
      workerCompletedAt,
      job.mainThreadPolicy
    ).then(job.resolve, job.reject).finally(() => {
      pumpSharedWebGpuWorkerQueue();
    });
  };

  slot.worker.onerror = (error) => {
    const job = slot.current;
    slot.current = null;
    slot.busy = false;
    resetSharedWebGpuWorkerSlot(pool, slot);
    if (job && !job.controller.cancelled) job.reject(error);
    pumpSharedWebGpuWorkerQueue();
  };
}

function getSharedWebGpuWorkerPool() {
  if (!sharedWebGpuWorkerPool) {
    const pool = {
      queue: [],
      slots: Array.from({ length: WEBGPU_WORKER_POOL_SIZE }, (_, index) => createSharedWebGpuWorkerSlot(index)),
    };
    for (const slot of pool.slots) {
      attachSharedWebGpuWorkerHandlers(pool, slot);
    }
    sharedWebGpuWorkerPool = pool;
  }
  return sharedWebGpuWorkerPool;
}

function resetSharedWebGpuWorkerSlot(pool, slot) {
  try { slot.worker.terminate(); } catch {}
  slot.worker = createVoxelWorker();
  slot.current = null;
  slot.busy = false;
  attachSharedWebGpuWorkerHandlers(pool, slot);
  return slot;
}

function getIdleSharedWebGpuWorkerSlot(pool) {
  for (const slot of pool.slots) {
    if (!slot.busy) return slot;
  }
  return null;
}

function pumpSharedWebGpuWorkerQueue() {
  const pool = sharedWebGpuWorkerPool;
  if (!pool || !pool.queue.length) return;

  while (pool.queue.length) {
    const slot = getIdleSharedWebGpuWorkerSlot(pool);
    if (!slot) return;

    const job = pool.queue.shift();
    if (job.controller.cancelled) {
      job.reject(new Error('Voxelization cancelled'));
      continue;
    }

    slot.busy = true;
    slot.current = job;
    job.workerPostedAt = nowMs();
    if (job.onStart) {
      try { job.onStart(job.controller); } catch {}
    }
    slot.worker.postMessage(job.payload, job.transfers);
  }
}

function enqueueSharedWebGpuWorkerJob({ payload, transfers, onStart, serializeStartedAt, mainThreadPolicy }) {
  const pool = getSharedWebGpuWorkerPool();
  return new Promise((resolve, reject) => {
    const job = {
      payload,
      transfers,
      onStart,
      serializeStartedAt,
      mainThreadPolicy,
      workerPostedAt: 0,
      resolve,
      reject,
      controller: {
        cancelled: false,
        terminate() {
          if (this.cancelled) return;
          this.cancelled = true;

          const activeSlot = pool.slots.find((slot) => slot.current === job) ?? null;
          if (activeSlot) {
            resetSharedWebGpuWorkerSlot(pool, activeSlot);
            reject(new Error('Voxelization cancelled'));
            pumpSharedWebGpuWorkerQueue();
            return;
          }

          const queuedIndex = pool.queue.indexOf(job);
          if (queuedIndex >= 0) pool.queue.splice(queuedIndex, 1);
          reject(new Error('Voxelization cancelled'));
        },
      },
    };

    pool.queue.push(job);
    pumpSharedWebGpuWorkerQueue();
  });
}

function voxelizeModelWithWorker({ model, serializedModel = null, resolution = 200, needGrid = false, method = '2.5d-scan', renderMode = 'mesh', onStart, preRotateYDeg = 0, mainThreadPolicy = null }) {
  return new Promise((resolve, reject) => {
    const serializeStartedAt = nowMs();
    const payload = serializedModel ?? serializeModel(model, { preRotateYDeg });

    /* collect ArrayBuffers for zero-copy transfer */
    const transfers = [];
    payload.meshes.forEach(m => {
      Object.values(m.geometry.attributes).forEach(a => transfers.push(a.array.buffer));
      if (m.geometry.index) transfers.push(m.geometry.index.array.buffer);
    });
    payload.imageDatas.forEach(([uuid, idata]) => transfers.push(idata.data.buffer));

    if (method === 'webgpu') {
      enqueueSharedWebGpuWorkerJob({
        payload: { modelData: payload, resolution, needGrid, method, renderMode },
        transfers,
        onStart,
        serializeStartedAt,
        mainThreadPolicy,
      }).then(resolve, reject);
      return;
    }

    let workerPostedAt = 0;
    const worker = createVoxelWorker();
    if (onStart) try { onStart(worker); } catch {}

    worker.onmessage = e => {
      const { status, result, message, stack } = e.data;
      const workerCompletedAt = nowMs();
      worker.terminate();

      if (status === 'error') {
        console.error('[voxelizer.worker] error:', message, stack);
        return reject(new Error(message));
      }
      rebuildWorkerGeometry(result, serializeStartedAt, workerPostedAt, workerCompletedAt, mainThreadPolicy)
        .then(resolve, reject);
    };

    worker.onerror = err => { worker.terminate(); reject(err); };
    workerPostedAt = nowMs();
    worker.postMessage({ modelData: payload, resolution, needGrid, method, renderMode }, transfers);
  });
}

async function voxelizeModelWithWebGpu({ model, renderer, resolution = 200, needGrid = false, method = 'webgpu', renderMode = 'mesh', onStart, preRotateYDeg = 0, mainThreadPolicy = null }) {
  const serializedModel = serializeModel(model, { preRotateYDeg });
  const { useWebGpu, analysis } = shouldUseWebGpuForSerializedModel(serializedModel, resolution);
  const dispatchMethod = useWebGpu ? 'webgpu' : '2.5d-scan';
  const dispatchRenderMode = !needGrid && renderMode === 'instances' ? 'instances' : 'mesh';

  const result = await voxelizeModelWithWorker({
    model,
    serializedModel,
    resolution,
    needGrid,
    method: dispatchMethod,
    renderMode: dispatchRenderMode,
    onStart,
    preRotateYDeg,
    mainThreadPolicy,
  });

  if (dispatchMethod === 'webgpu') {
    return result;
  }

  return {
    ...result,
    stats: {
      ...(result.stats || {}),
      requestedMethod: method,
      method: result.stats?.method ?? dispatchMethod,
      dispatchReason: `Auto-routed to 2.5d-scan (${analysis.triangleCount} tris across ${analysis.meshCount} meshes at res ${resolution})`,
      webGpuDispatch: {
        usedWebGpu: false,
        triangleCount: analysis.triangleCount,
        meshCount: analysis.meshCount,
        texturedMaterialCount: analysis.texturedMaterialCount,
      },
    },
  };
}

export async function voxelizeModel({ model, renderer = null, resolution = 200, needGrid = false, method = '2.5d-scan', renderMode = 'mesh', onStart, preRotateYDeg = 0, mainThreadPolicy = null }) {
  if (method === 'webgpu') {
    try {
      return await voxelizeModelWithWebGpu({ model, renderer, resolution, needGrid, method, renderMode, onStart, preRotateYDeg, mainThreadPolicy });
    } catch (error) {
      if (isVoxelizationCancellationError(error)) {
        throw error;
      }
      const fallback = await voxelizeModelWithWorker({
        model,
        resolution,
        needGrid,
        method: '2.5d-scan',
        renderMode: !needGrid && renderMode === 'instances' ? 'instances' : 'mesh',
        onStart,
        preRotateYDeg,
        mainThreadPolicy,
      });
      return {
        ...fallback,
        stats: {
          ...(fallback.stats || {}),
          requestedMethod: 'webgpu',
          method: fallback.stats?.method ?? '2.5d-scan',
          fallbackReason: error?.message
            ? `WebGPU unavailable, fell back to 2.5d-scan: ${error.message}`
            : 'WebGPU unavailable, fell back to 2.5d-scan',
        },
      };
    }
  }

  return voxelizeModelWithWorker({ model, resolution, needGrid, method, renderMode, onStart, preRotateYDeg, mainThreadPolicy });
}
