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
  canvas.width = img.width;
  canvas.height = img.height;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const idata = ctx.getImageData(0, 0, img.width, img.height);
    
    // Debug: Log center pixel of first texture
    if (!window._loggedTexture) {
        window._loggedTexture = true;
        const cx = Math.floor(img.width/2);
        const cy = Math.floor(img.height/2);
        const idx = (cy * img.width + cx) * 4;
        const d = idata.data;
        console.log(`[voxelize-model] Texture sample (${img.width}x${img.height}) type=${img.constructor.name} @ center: R=${d[idx]} G=${d[idx+1]} B=${d[idx+2]} A=${d[idx+3]}`);
    }
    
    return idata;   // Uint8ClampedArray
  } catch (e) {
    console.warn('[voxelize-model] textureToPixels failed (likely CORS):', e);
    // Return a 1x1 Magenta pixel to indicate error visibly
    return new ImageData(new Uint8ClampedArray([255, 0, 255, 255]), 1, 1);
  }
}

/* --------------------------------------------------------------- */
/* 1️⃣  serialise the model                                         */
/* --------------------------------------------------------------- */
function serializeModel(model, { preRotateYDeg = 0 } = {}) {
  const meshes = [];
  const materialStore = new Map();   // uuid → serialised material
  const imageStore = new Map();   // uuid → ImageData

  model.updateWorldMatrix(true, true);

  model.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.isBufferGeometry) return;

    /* ── materials & textures ───────────────────────────────────── */
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat || materialStore.has(mat.uuid)) continue;

      const m = {
        uuid: mat.uuid,
        type: mat.type,
        color: mat.color ? mat.color.getHex() : undefined,
        emissive: mat.emissive ? mat.emissive.getHex() : undefined,
      };

      for (const key of ['map', 'emissiveMap', 'alphaMap']) {
        const t = mat[key];
        if (!(t && t.isTexture)) continue;

        const idata = textureToPixels(t);
        if (idata) {
          if (!imageStore.has(t.source.uuid)) imageStore.set(t.source.uuid, idata);

          m[key] = {
            imageUuid: t.source.uuid,
            encoding: t.encoding,
            isSRGB: (t.colorSpace === 'srgb' || t.encoding === 3001 || t.encoding === 3000), // Handle Three.js r152+ colorSpace and sRGBEncoding (3001)
            flipY: t.flipY,
            wrapS: t.wrapS,
            wrapT: t.wrapT,
            offset: t.offset.toArray(),
            repeat: t.repeat.toArray(),
            rotation: t.rotation,
            center: t.center.toArray(),
          };
        }
      }
      materialStore.set(mat.uuid, m);
    }

    /* ── geometry (preserve typed-array class) ───────────────────── */
    const g = o.geometry;
    const attributes = {};
    for (const [name, attr] of Object.entries(g.attributes)) {
      const clone = new (attr.array.constructor)(attr.array);
      attributes[name] = { array: clone, itemSize: attr.itemSize };
    }

    meshes.push({
      geometry: {
        attributes,
        groups: g.groups,
        index: g.index ? { array: new (g.index.array.constructor)(g.index.array) } : null
      },
      materials: mats.map(m => m.uuid),
      matrixWorld: o.matrixWorld.toArray()
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

  return {
    meshes,
    materials: Array.from(materialStore.values()),
    imageDatas: Array.from(imageStore.entries()),     // [uuid, ImageData]
    bbox: { min: bbox.min.toArray(), max: bbox.max.toArray() }
  };
}

/* --------------------------------------------------------------- */
/* 2️⃣  send to worker, receive voxel mesh back                     */
/* --------------------------------------------------------------- */
/* --------------------------------------------------------------- */
/* 2️⃣  send to worker, receive voxel mesh back                     */
/* --------------------------------------------------------------- */
export function voxelizeModel({ model, resolution = 200, needGrid = false, method = '2.5d-scan', onStart, onProgress, onChunk, preRotateYDeg = 0 }) {
  return new Promise((resolve, reject) => {

    const worker = new Worker(
      new URL('./voxelizer.worker.js', import.meta.url),
      { type: 'module' }
    );
    if (onStart) try { onStart(worker); } catch { }

    const chunks = [];
    let totalVoxels = 0;

    worker.onmessage = e => {
      const { status, result, message, stack, current, total } = e.data;

      if (status === 'progress') {
        if (onProgress) onProgress(current, total);
        return;
      }

      if (status === 'error') {
        worker.terminate();
        console.error('[voxelizer.worker] error:', message, stack);
        return reject(new Error(message));
      }

      if (status === 'success') {
        worker.terminate();
        
        const group = new THREE.Group();
        const geometries = result.geometries || [];
        
        console.log('[voxelizeModel] Worker success. Geometries:', geometries.length, 'VoxelGrid:', result.voxelGrid ? 'yes' : 'no');

        // Debug: Check first geometry colors
        if (geometries.length > 0 && geometries[0].colors8) {
            const c = geometries[0].colors8;
            if (c.length >= 4) {
                console.log(`[voxelizeModel] First voxel color: R=${c[0]} G=${c[1]} B=${c[2]} A=${c[3]}`);
                if (c[0]===0 && c[1]===0 && c[2]===0) {
                    console.warn('[voxelizeModel] ⚠️ First voxel is BLACK. This might indicate texture/material issues.');
                }
            }
        }

        for (const geometry of geometries) {
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3));
            geom.setAttribute('color', new THREE.BufferAttribute(geometry.colors8, 4, true));
            geom.setIndex(new THREE.BufferAttribute(geometry.indices, 1));

            // Bounds
            if (geometry.bounds) {
                const min = new THREE.Vector3().fromArray(geometry.bounds.min);
                const max = new THREE.Vector3().fromArray(geometry.bounds.max);
                geom.boundingBox = new THREE.Box3(min, max);
                geom.boundingSphere = new THREE.Sphere(
                    min.clone().add(max).multiplyScalar(0.5),
                    min.distanceTo(max) * 0.5
                );
            } else {
                geom.computeBoundingBox();
                geom.computeBoundingSphere();
            }

            const mesh = new THREE.Mesh(
                geom,
                new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
            );
            mesh.frustumCulled = false;
            
            if (geometry.bounds) {
                mesh.userData.chunkBounds = geometry.bounds;
            }

            if (onChunk) {
                onChunk(mesh);
            }
            group.add(mesh);
        }

        resolve({
          voxelMesh: group,
          voxelCount: result.voxelCount || 0,
          _voxelGrid: result.voxelGrid // Pass back the grid data if available
        });
      }
    };

    worker.onerror = err => { worker.terminate(); reject(err); };

    const payload = serializeModel(model, { preRotateYDeg });

    /* collect ArrayBuffers for zero-copy transfer */
    const transfers = [];
    payload.meshes.forEach(m => {
      Object.values(m.geometry.attributes).forEach(a => transfers.push(a.array.buffer));
      if (m.geometry.index) transfers.push(m.geometry.index.array.buffer);
    });
    payload.imageDatas.forEach(([uuid, idata]) => transfers.push(idata.data.buffer));

    worker.postMessage({ modelData: payload, resolution, needGrid, method }, transfers);
  });
}
