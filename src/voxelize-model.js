import * as THREE from 'three';

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
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);   // Uint8ClampedArray
}

/* --------------------------------------------------------------- */
/* 1️⃣  serialise the model                                         */
/* --------------------------------------------------------------- */
function serializeModel(model) {
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

  return {
    meshes,
    materials  : Array.from(materialStore.values()),
    imageDatas : Array.from(imageStore.entries()),     // [uuid, ImageData]
    bbox       : { min: bbox.min.toArray(), max: bbox.max.toArray() }
  };
}

/* --------------------------------------------------------------- */
/* 2️⃣  send to worker, receive voxel mesh back                     */
/* --------------------------------------------------------------- */
export function voxelizeModel({ model, resolution = 200 }) {
  return new Promise((resolve, reject) => {

    const worker = new Worker(
      new URL('./voxelizer.worker.js', import.meta.url),
      { type:'module' }
    );

    worker.onmessage = e => {
      const { status, result, message, stack } = e.data;
      worker.terminate();

      if (status === 'error') {
        console.error('[voxelizer.worker] error:', message, stack);
        return reject(new Error(message));
      }

      /* rebuild THREE geometries with chunk bounds for frustum culling */
      const group = new THREE.Group();
      for (const g of result.geometries) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
        
        // NEW: RGBA8 (4 bytes) -> arrayStride = 4 (legal on WebGPU)
        const vertCount = g.colors.length / 3;
        const c8 = new Uint8Array(vertCount * 4);
        for (let v = 0; v < vertCount; v++) {
          const r = Math.max(0, Math.min(255, (g.colors[v*3+0] * 255) | 0));
          const gC= Math.max(0, Math.min(255, (g.colors[v*3+1] * 255) | 0));
          const b = Math.max(0, Math.min(255, (g.colors[v*3+2] * 255) | 0));
          c8[v*4+0] = r; c8[v*4+1] = gC; c8[v*4+2] = b; c8[v*4+3] = 255; // alpha pad
        }
        geom.setAttribute('color', new THREE.BufferAttribute(c8, 4, true));
        
        // normals are required by the WebGPU pipeline three builds for MeshBasicMaterial
        geom.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
        
        geom.setIndex      (new THREE.BufferAttribute(g.indices, 1));
        geom.computeBoundingSphere();
        
        const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors:true }));
        
        // Store chunk bounds for frustum culling (if available from greedy meshing)
        if (g.bounds) {
          mesh.userData.chunkBounds = {
            min: new THREE.Vector3(g.bounds.min[0], g.bounds.min[1], g.bounds.min[2]),
            max: new THREE.Vector3(g.bounds.max[0], g.bounds.max[1], g.bounds.max[2])
          };
        }
        
        group.add(mesh);
      }

      resolve({
        voxelMesh : group,
        voxelCount: result.voxelCount,
        _voxelGrid: {
          ...result.voxelGrid,
          bbox     : new THREE.Box3(
            new THREE.Vector3().fromArray(result.voxelGrid.bbox.min),
            new THREE.Vector3().fromArray(result.voxelGrid.bbox.max)
          ),
          gridSize : new THREE.Vector3().copy(result.voxelGrid.gridSize),
          unit     : new THREE.Vector3().copy(result.voxelGrid.unit)
        }
      });
    };

    worker.onerror = err => { worker.terminate(); reject(err); };

    const payload = serializeModel(model);

    /* collect ArrayBuffers for zero-copy transfer */
    const transfers = [];
    payload.meshes.forEach(m => {
      Object.values(m.geometry.attributes).forEach(a => transfers.push(a.array.buffer));
      if (m.geometry.index) transfers.push(m.geometry.index.array.buffer);
    });
    payload.imageDatas.forEach(([uuid, idata]) => transfers.push(idata.data.buffer));

    worker.postMessage({ modelData: payload, resolution }, transfers);
  });
}
