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
function serializeModel(model, { preRotateYDeg = 0 } = {}) {
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
    materials  : Array.from(materialStore.values()),
    imageDatas : Array.from(imageStore.entries()),     // [uuid, ImageData]
    bbox       : { min: bbox.min.toArray(), max: bbox.max.toArray() }
  };
}

/* --------------------------------------------------------------- */
/* 2️⃣  send to worker, receive voxel mesh back                     */
/* --------------------------------------------------------------- */
export function voxelizeModel({ model, resolution = 200, needGrid = false, method = '2.5d-scan', onStart, preRotateYDeg = 0 }) {
  return new Promise((resolve, reject) => {

    const worker = new Worker(
      new URL('./voxelizer.worker.js', import.meta.url),
      { type:'module' }
    );
    if (onStart) try { onStart(worker); } catch {}

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

        // Prefer worker-packed RGBA8 colors (normalized) else fallback pack here
        if (g.colors8) {
          geom.setAttribute('color', new THREE.BufferAttribute(g.colors8, 4, true));
        } else if (g.colors) {
          const srcColors = g.colors;
            const vertCount = srcColors.length / 3;
            const c8 = new Uint8Array(vertCount * 4);
            for (let v = 0; v < vertCount; v++) {
              let r = srcColors[v*3+0], g1 = srcColors[v*3+1], b = srcColors[v*3+2];
              if (!Number.isFinite(r) || !Number.isFinite(g1) || !Number.isFinite(b)) { r = g1 = b = 1; }
              c8[v*4+0] = (r * 255) & 255;
              c8[v*4+1] = (g1 * 255) & 255;
              c8[v*4+2] = (b * 255) & 255;
              c8[v*4+3] = 255;
            }
            geom.setAttribute('color', new THREE.BufferAttribute(c8, 4, true));
        } else {
          const vertCount = g.positions.length / 3;
          const c8 = new Uint8Array(vertCount * 4);
          for (let v = 0; v < vertCount; v++) { c8[v*4+0]=c8[v*4+1]=c8[v*4+2]=c8[v*4+3]=255; }
          geom.setAttribute('color', new THREE.BufferAttribute(c8, 4, true));
        }

        if (g.normals) geom.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
        geom.setIndex(new THREE.BufferAttribute(g.indices, 1));

        // Fast bounds (avoid computeBoundingSphere per chunk)
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

      resolve({
        voxelMesh : group,
        voxelCount: result.voxelCount,
        _voxelGrid: result.voxelGrid
          ? {
              ...result.voxelGrid,
              bbox     : new THREE.Box3(
                new THREE.Vector3().fromArray(result.voxelGrid.bbox.min),
                new THREE.Vector3().fromArray(result.voxelGrid.bbox.max)
              ),
              gridSize : new THREE.Vector3(result.voxelGrid.gridSize.x, result.voxelGrid.gridSize.y, result.voxelGrid.gridSize.z),
              unit     : new THREE.Vector3(result.voxelGrid.unit.x, result.voxelGrid.unit.y, result.voxelGrid.unit.z)
            }
          : null
      });
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
