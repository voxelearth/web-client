/* voxelizer.worker.js (OPTIMIZED) */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ALPHA_CUTOFF = 0.08;
const ALPHA_EPS = 1e-3;
const CHUNK_SIZE = 32;
const PROGRESS_THROTTLE = 50; // Report progress every N chunks (not every chunk!)

// --- Helper: Texture Sampling (Linear) ---
const _samplers = new WeakMap();
function getSampler(tex, imageDatas) {
    if (!tex || !tex.source || !imageDatas.has(tex.source.uuid)) return null;
    if (_samplers.has(tex)) return _samplers.get(tex);

    let sampler = null;
    const imgData = imageDatas.get(tex.source.uuid);

    if (imgData) {
        const { data, width, height } = imgData;
        const { offset, repeat, rotation, center, flipY, wrapS, wrapT } = tex;
        const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
        const srgbToLin = x => (x <= 0.04045) ? (x / 12.92) : Math.pow((x + 0.055) / 1.055, 2.4);

        sampler = (uv, wantRGBA = false) => {
            let u = uv.x * repeat.x + offset.x, v = uv.y * repeat.y + offset.y;
            if (rotation !== 0) {
                u -= center.x; v -= center.y;
                const u2 = u * cosR - v * sinR, v2 = u * sinR + v * cosR;
                u = u2 + center.x; v = v2 + center.y;
            }
            u = wrapS === THREE.RepeatWrapping ? ((u % 1) + 1) % 1 : THREE.MathUtils.clamp(u, 0, 1);
            v = wrapT === THREE.RepeatWrapping ? ((v % 1) + 1) % 1 : THREE.MathUtils.clamp(v, 0, 1);
            if (flipY) v = 1 - v;

            const x = u * (width - 1), y = v * (height - 1);
            const x0 = Math.floor(x), x1 = Math.min(width - 1, x0 + 1);
            const y0 = Math.floor(y), y1 = Math.min(height - 1, y0 + 1);
            const tx = x - x0, ty = y - y0;

            const sample = (ix, iy) => {
                const i = (iy * width + ix) * 4;
                let r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255, a = data[i + 3] / 255;
                if (tex.encoding === THREE.sRGBEncoding) {
                    r = srgbToLin(r); g = srgbToLin(g); b = srgbToLin(b);
                }
                return [r, g, b, a];
            };

            const c00 = sample(x0, y0), c10 = sample(x1, y0), c01 = sample(x0, y1), c11 = sample(x1, y1);
            const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;

            const a = c00[3] * w00 + c10[3] * w10 + c01[3] * w01 + c11[3] * w11;
            let r = c00[0] * c00[3] * w00 + c10[0] * c10[3] * w10 + c01[0] * c01[3] * w01 + c11[0] * c11[3] * w11;
            let g = c00[1] * c00[3] * w00 + c10[1] * c10[3] * w10 + c01[1] * c01[3] * w01 + c11[1] * c11[3] * w11;
            let b = c00[2] * c00[3] * w00 + c10[2] * c10[3] * w10 + c01[2] * c01[3] * w01 + c11[2] * c11[3] * w11;

            if (a > 1e-5) { r /= a; g /= a; b /= a; } else { r = 0; g = 0; b = 0; }
            return wantRGBA ? [r, g, b, a] : [r, g, b];
        };
        sampler._du = 1 / width; sampler._dv = 1 / height;
    }
    _samplers.set(tex, sampler);
    return sampler;
}

function sampleAlbedoLinear(material, uv, imageDatas) {
    let aSum = 0, rSum = 0, gSum = 0, bSum = 0;
    const tex = material.map;
    if (tex) {
        const s = getSampler(tex, imageDatas);
        if (s) {
            const c = s(uv, true);
            const a = Math.max(0, Math.min(1, c[3] || 0));
            if (a > 0) { rSum += c[0] * a; gSum += c[1] * a; bSum += c[2] * a; aSum += a; }
        }
    }
    if (aSum <= ALPHA_EPS) return null;
    return [rSum / aSum, gSum / aSum, bSum / aSum, aSum];
}

function kMeansPalette(colors, k = 64, iters = 8) {
    let n = colors.length / 3;
    const MAX_SAMPLES = 4096;
    if (n > MAX_SAMPLES) {
        const sampled = new Float32Array(MAX_SAMPLES * 3);
        const step = Math.ceil(n / MAX_SAMPLES);
        let m = 0;
        for (let i = 0; i < n && m < MAX_SAMPLES; i += step) {
            sampled[m * 3 + 0] = colors[i * 3 + 0];
            sampled[m * 3 + 1] = colors[i * 3 + 1];
            sampled[m * 3 + 2] = colors[i * 3 + 2];
            m++;
        }
        colors = sampled; n = m;
    }
    if (n === 0) return { palette: new Float32Array([1, 1, 1]) };

    k = Math.min(k, n);
    const cent = new Float32Array(k * 3);
    for (let c = 0; c < k; ++c) {
        const s = Math.min(n - 1, Math.floor((c + 0.5) * n / k));
        cent[c * 3 + 0] = colors[s * 3 + 0]; cent[c * 3 + 1] = colors[s * 3 + 1]; cent[c * 3 + 2] = colors[s * 3 + 2];
    }

    const sums = new Float32Array(k * 3), cnts = new Uint32Array(k);
    for (let it = 0; it < iters; ++it) {
        sums.fill(0); cnts.fill(0);
        for (let p = 0; p < n; ++p) {
            const r = colors[p * 3 + 0], g = colors[p * 3 + 1], b = colors[p * 3 + 2];
            let best = 0, bestD = Infinity;
            for (let c = 0; c < k; ++c) {
                const dr = r - cent[c * 3 + 0], dg = g - cent[c * 3 + 1], db = b - cent[c * 3 + 2];
                const d2 = dr * dr + dg * dg + db * db;
                if (d2 < bestD) { bestD = d2; best = c; }
            }
            sums[best * 3 + 0] += r; sums[best * 3 + 1] += g; sums[best * 3 + 2] += b; cnts[best]++;
        }
        for (let c = 0; c < k; ++c) {
            if (cnts[c] === 0) {
                const s = Math.floor(Math.random() * n);
                cent[c * 3 + 0] = colors[s * 3 + 0]; cent[c * 3 + 1] = colors[s * 3 + 1]; cent[c * 3 + 2] = colors[s * 3 + 2];
            } else {
                const inv = 1 / cnts[c];
                cent[c * 3 + 0] = sums[c * 3 + 0] * inv; cent[c * 3 + 1] = sums[c * 3 + 1] * inv; cent[c * 3 + 2] = sums[c * 3 + 2] * inv;
            }
        }
    }
    return { palette: cent };
}

// --- Streaming Voxelizer ---
class StreamingVoxelizer {
    async init({ modelData, voxelSize, maxGrid = Infinity, paletteSize = 256, needGrid = false, method = '2.5d-scan' }) {
        this.voxelSize = voxelSize;
        this.paletteSize = paletteSize;
        this.needGrid = needGrid;
        this.imageDatas = new Map(modelData.imageDatas);

        const model = this.#reconstructModel(modelData);
        const baked = this.#bakeAndMerge(model);
        this.positions = baked.positions; this.uvs = baked.uvs;
        this.indices = baked.indices; this.triMats = baked.triMats;
        this.palette = baked.palette; this.materials = baked.materials;

        this.bbox = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); this.bbox.getSize(size);
        let nx = Math.ceil(size.x / voxelSize), ny = Math.ceil(size.y / voxelSize), nz = Math.ceil(size.z / voxelSize);
        const m = Math.max(nx, ny, nz), scale = Number.isFinite(maxGrid) && m > maxGrid ? maxGrid / m : 1;
        this.grid = new THREE.Vector3(Math.ceil(nx * scale), Math.ceil(ny * scale), Math.ceil(nz * scale));
        this.voxelSize /= scale;

        // Pre-calculate triangle bounds in voxel space
        this.triBounds = new Uint32Array((this.indices.length / 3) * 6); // minX,maxX, minY,maxY, minZ,maxZ
        this.#computeTriangleBounds();

        // Stream chunks
        await this.#streamChunks();
    }


    #reconstructModel(modelData) {
        const group = new THREE.Group();
        const materials = new Map();
        const textures = new Map();

        for (const matData of modelData.materials) {
            const MaterialClass = THREE[matData.type] || THREE.MeshStandardMaterial;
            const mat = new MaterialClass();
            mat.uuid = matData.uuid;
            if (matData.color !== undefined) mat.color.setHex(matData.color);
            if (matData.emissive !== undefined) mat.emissive.setHex(matData.emissive);

            for (const key of ['map', 'emissiveMap', 'alphaMap']) {
                if (matData[key]) {
                    const texData = matData[key];
                    if (!textures.has(texData.imageUuid)) {
                        const tex = new THREE.Texture();
                        tex.source.uuid = texData.imageUuid; tex.encoding = texData.encoding;
                        tex.flipY = texData.flipY; tex.wrapS = texData.wrapS; tex.wrapT = texData.wrapT;
                        tex.offset.fromArray(texData.offset); tex.repeat.fromArray(texData.repeat);
                        tex.rotation = texData.rotation; tex.center.fromArray(texData.center);
                        textures.set(texData.imageUuid, tex);
                    }
                    mat[key] = textures.get(texData.imageUuid);
                }
            }
            materials.set(mat.uuid, mat);
        }

        for (const meshData of modelData.meshes) {
            const geometry = new THREE.BufferGeometry();
            for (const [attr, { array, itemSize }] of Object.entries(meshData.geometry.attributes)) {
                geometry.setAttribute(attr, new THREE.BufferAttribute(array, itemSize));
            }
            if (meshData.geometry.index) {
                geometry.setIndex(new THREE.BufferAttribute(meshData.geometry.index.array, 1));
            }
            geometry.groups = meshData.geometry.groups;
            const meshMaterials = meshData.materials.map(uuid => materials.get(uuid));
            const mesh = new THREE.Mesh(geometry, meshMaterials.length > 1 ? meshMaterials : meshMaterials[0]);
            mesh.applyMatrix4(new THREE.Matrix4().fromArray(meshData.matrixWorld));
            group.add(mesh);
        }
        return group;
    }

    #bakeAndMerge(root) {
        const geoms = [], indices = [], allRGB = [], triMats = [], uvs = [], materials = [];
        const matMap = new Map();
        let offset = 0;
        root.traverse(o => {
            if (!o.isMesh || !o.geometry.getAttribute('position')) return;
            o.updateWorldMatrix(true, false);
            const g = o.geometry.clone().applyMatrix4(o.matrixWorld).toNonIndexed();
            const posA = g.getAttribute('position');
            if (!posA) return;

            const meshMats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of meshMats) { if (m && !matMap.has(m)) { matMap.set(m, materials.length); materials.push(m); } }

            const groups = g.groups.length ? g.groups : [{ start: 0, count: posA.count, materialIndex: 0 }];
            const uvA = g.getAttribute('uv');

            for (const grp of groups) {
                const m = meshMats[grp.materialIndex];
                if (!m) continue;
                const baseR = m.color ? m.color.r : 1;
                const baseG = m.color ? m.color.g : 1;
                const baseB = m.color ? m.color.b : 1;
                for (let vi = grp.start; vi < grp.start + grp.count; ++vi) {
                    let r = baseR, g = baseG, b = baseB; let had = false;
                    if (uvA) {
                        const u = uvA.getX(vi), v = uvA.getY(vi);
                        const albedo = sampleAlbedoLinear(m, new THREE.Vector2(u, v), this.imageDatas);
                        if (albedo) { r *= albedo[0]; g *= albedo[1]; b *= albedo[2]; had = true; }
                        if (m.emissive) { r += m.emissive.r; g += m.emissive.g; b += m.emissive.b; }
                    } else {
                        if (m.emissive) { r += m.emissive.r; g += m.emissive.g; b += m.emissive.b; }
                        had = true;
                    }
                    if (!(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b))) { r = g = b = 1; }
                    r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b;
                    if (had) allRGB.push(r, g, b);
                }
            }

            if (uvA) { for (let i = 0; i < posA.count; ++i) uvs.push(uvA.getX(i), uvA.getY(i)); }
            else { for (let i = 0; i < posA.count; ++i) uvs.push(0, 0); }

            for (const grp of groups) {
                const m = meshMats[grp.materialIndex];
                if (!m) continue;
                const globalMatIdx = matMap.get(m);
                for (let i = grp.start; i < grp.start + grp.count; i += 3) {
                    indices.push(offset + i, offset + i + 1, offset + i + 2);
                    triMats.push(globalMatIdx);
                }
            }
            offset += posA.count;
            geoms.push(g);
        });

        if (geoms.length === 0) return { positions: new Float32Array(), uvs: new Float32Array(), indices: new Uint32Array(), triMats: new Uint32Array(), palette: new Float32Array(), materials: [] };

        const merged = mergeGeometries(geoms, false);
        return {
            positions: merged.attributes.position.array, uvs: new Float32Array(uvs),
            indices: new Uint32Array(indices), triMats: new Uint32Array(triMats),
            palette: kMeansPalette(new Float32Array(allRGB), this.paletteSize).palette,
            materials
        };
    }

    #computeTriangleBounds() {
        const numTri = this.indices.length / 3;
        const invVS = 1 / this.voxelSize;
        const bx = this.bbox.min.x, by = this.bbox.min.y, bz = this.bbox.min.z;
        const NX = this.grid.x, NY = this.grid.y, NZ = this.grid.z;

        for (let t = 0; t < numTri; t++) {
            const i0 = this.indices[t * 3 + 0], i1 = this.indices[t * 3 + 1], i2 = this.indices[t * 3 + 2];
            const x0 = (this.positions[i0 * 3 + 0] - bx) * invVS, y0 = (this.positions[i0 * 3 + 1] - by) * invVS, z0 = (this.positions[i0 * 3 + 2] - bz) * invVS;
            const x1 = (this.positions[i1 * 3 + 0] - bx) * invVS, y1 = (this.positions[i1 * 3 + 1] - by) * invVS, z1 = (this.positions[i1 * 3 + 2] - bz) * invVS;
            const x2 = (this.positions[i2 * 3 + 0] - bx) * invVS, y2 = (this.positions[i2 * 3 + 1] - by) * invVS, z2 = (this.positions[i2 * 3 + 2] - bz) * invVS;

            const minX = Math.floor(Math.min(x0, x1, x2)), maxX = Math.floor(Math.max(x0, x1, x2));
            const minY = Math.floor(Math.min(y0, y1, y2)), maxY = Math.floor(Math.max(y0, y1, y2));
            const minZ = Math.floor(Math.min(z0, z1, z2)), maxZ = Math.floor(Math.max(z0, z1, z2));

            // Clamp to grid
            this.triBounds[t * 6 + 0] = Math.max(0, minX); this.triBounds[t * 6 + 1] = Math.min(NX - 1, maxX);
            this.triBounds[t * 6 + 2] = Math.max(0, minY); this.triBounds[t * 6 + 3] = Math.min(NY - 1, maxY);
            this.triBounds[t * 6 + 4] = Math.max(0, minZ); this.triBounds[t * 6 + 5] = Math.min(NZ - 1, maxZ);
        }
    }

    async #streamChunks() {
        const NX = this.grid.x, NY = this.grid.y, NZ = this.grid.z;
        const totalChunks = Math.ceil(NX / CHUNK_SIZE) * Math.ceil(NY / CHUNK_SIZE) * Math.ceil(NZ / CHUNK_SIZE);
        let processedChunks = 0;

        // Iterate chunks
        for (let z0 = 0; z0 < NZ; z0 += CHUNK_SIZE) {
            for (let y0 = 0; y0 < NY; y0 += CHUNK_SIZE) {
                for (let x0 = 0; x0 < NX; x0 += CHUNK_SIZE) {
                    const x1 = Math.min(NX, x0 + CHUNK_SIZE);
                    const y1 = Math.min(NY, y0 + CHUNK_SIZE);
                    const z1 = Math.min(NZ, z0 + CHUNK_SIZE);

                    // 1. Identify triangles in this chunk (FAST AABB test)
                    const chunkTris = [];
                    const numTri = this.indices.length / 3;
                    for (let t = 0; t < numTri; t++) {
                        if (this.triBounds[t * 6 + 1] < x0 || this.triBounds[t * 6 + 0] >= x1) continue;
                        if (this.triBounds[t * 6 + 3] < y0 || this.triBounds[t * 6 + 2] >= y1) continue;
                        if (this.triBounds[t * 6 + 5] < z0 || this.triBounds[t * 6 + 4] >= z1) continue;
                        chunkTris.push(t);
                    }

                    if (chunkTris.length === 0) {
                        processedChunks++;
                        if (processedChunks % PROGRESS_THROTTLE === 0 || processedChunks === totalChunks) {
                            this.#reportProgress(processedChunks, totalChunks);
                        }
                        continue;
                    }

                    // 2. Rasterize chunk (OPTIMIZED 2.5D scan)
                    const { voxelHits, paletteStore } = this.#rasterizeChunk(x0, x1, y0, y1, z0, z1, chunkTris);

                    // 3. Greedy mesh chunk
                    if (voxelHits.size > 0) {
                        const geometry = this.#greedyMeshChunk(x0, x1, y0, y1, z0, z1, paletteStore);
                        if (geometry.indices.length > 0) {
                            this.#sendGeometry(geometry);
                        }
                    }

                    processedChunks++;
                    // Throttled progress reporting
                    if (processedChunks % PROGRESS_THROTTLE === 0 || processedChunks === totalChunks) {
                        this.#reportProgress(processedChunks, totalChunks);
                    }

                    // Yield less frequently (every 10 chunks instead of 5)
                    if (processedChunks % 10 === 0) await new Promise(r => setTimeout(r, 0));
                }
            }
        }

        self.postMessage({ status: 'done' });
    }

    #rasterizeChunk(x0, x1, y0, y1, z0, z1, chunkTris) {
        const voxelHits = new Map();
        const paletteStore = new Uint16Array((x1 - x0) * (y1 - y0) * (z1 - z0));
        
        const invVS = 1 / this.voxelSize;
        const bx = this.bbox.min.x, by = this.bbox.min.y, bz = this.bbox.min.z;
        const NX = this.grid.x, NY = this.grid.y, NZ = this.grid.z;
        
        const lx = x1 - x0, ly = y1 - y0;
        const localIdx = (x, y, z) => (x - x0) + lx * ((y - y0) + ly * (z - z0));
        
        // Precompute voxel-space positions once
        const pVox = new Float32Array(this.positions.length);
        for (let i = 0, n = this.positions.length / 3; i < n; i++) {
            pVox[i*3+0] = (this.positions[i*3+0] - bx) * invVS;
            pVox[i*3+1] = (this.positions[i*3+1] - by) * invVS;
            pVox[i*3+2] = (this.positions[i*3+2] - bz) * invVS;
        }

        // Process each triangle with optimized 2.5D scan
        for (const t of chunkTris) {
            const i0 = this.indices[t*3+0], i1 = this.indices[t*3+1], i2 = this.indices[t*3+2];
            
            const x0v = pVox[i0*3+0], y0v = pVox[i0*3+1], z0v = pVox[i0*3+2];
            const x1v = pVox[i1*3+0], y1v = pVox[i1*3+1], z1v = pVox[i1*3+2];
            const x2v = pVox[i2*3+0], y2v = pVox[i2*3+1], z2v = pVox[i2*3+2];
            
            const e10x = x1v - x0v, e10y = y1v - y0v, e10z = z1v - z0v;
            const e20x = x2v - x0v, e20y = y2v - y0v, e20z = z2v - z0v;
            const nx = e10y*e20z - e10z*e20y, ny = e10z*e20x - e10x*e20z, nz = e10x*e20y - e10y*e20x;
            const nn = nx*nx + ny*ny + nz*nz;
            if (nn < 1e-12) continue;
            
            const abx = Math.abs(nx), aby = Math.abs(ny), abz = Math.abs(nz);
            let wAxis, uAxis, vAxis;
            if (abx >= aby && abx >= abz) { wAxis = 0; uAxis = 1; vAxis = 2; }
            else if (aby >= abx && aby >= abz) { wAxis = 1; uAxis = 2; vAxis = 0; }
            else { wAxis = 2; uAxis = 0; vAxis = 1; }
            
            const pick = (axis, x, y, z) => (axis===0?x:axis===1?y:z);
            const U0 = pick(uAxis, x0v, y0v, z0v), V0 = pick(vAxis, x0v, y0v, z0v), W0 = pick(wAxis, x0v, y0v, z0v);
            const U1 = pick(uAxis, x1v, y1v, z1v), V1 = pick(vAxis, x1v, y1v, z1v), W1 = pick(wAxis, x1v, y1v, z1v);
            const U2 = pick(uAxis, x2v, y2v, z2v), V2 = pick(vAxis, x2v, y2v, z2v), W2 = pick(wAxis, x2v, y2v, z2v);
            
            const denom = (V1 - V2)*(U0 - U2) + (U2 - U1)*(V0 - V2);
            if (Math.abs(denom) < 1e-12) continue;
            const invDen = 1.0 / denom;
            
            const pickMin = (axis) => (axis===0?x0:axis===1?y0:z0);
            const pickMax = (axis) => (axis===0?x1:axis===1?y1:z1);
            const uMin = Math.max(pickMin(uAxis), Math.floor(Math.min(U0, U1, U2)));
            const vMin = Math.max(pickMin(vAxis), Math.floor(Math.min(V0, V1, V2)));
            const uMax = Math.min(pickMax(uAxis) - 1, Math.floor(Math.max(U0, U1, U2)));
            const vMax = Math.min(pickMax(vAxis) - 1, Math.floor(Math.max(V0, V1, V2)));
            
            if (uMin > uMax || vMin > vMax) continue;
            
            const dL0du = (V1 - V2) * invDen, dL1du = (V2 - V0) * invDen;
            const nW = pick(wAxis, nx, ny, nz);
            const distScale = (nW*nW) / nn;
            const dWdu = dL0du*W0 + dL1du*W1 - (dL0du + dL1du)*W2;
            const wMin = pickMin(wAxis), wMax = pickMax(wAxis);
            
            for (let v = vMin; v <= vMax; v++) {
                const uu0 = uMin + 0.5, vv0 = v + 0.5;
                let L0 = ((V1 - V2)*(uu0 - U2) + (U2 - U1)*(vv0 - V2)) * invDen;
                let L1 = ((V2 - V0)*(uu0 - U2) + (U0 - U2)*(vv0 - V2)) * invDen;
                let L2 = 1.0 - L0 - L1;
                let W = L0*W0 + L1*W1 + L2*W2;
                
                for (let u = uMin; u <= uMax; u++) {
                    if (L0 >= -1e-6 && L1 >= -1e-6 && L2 >= -1e-6) {
                        const wIdx = Math.floor(W);
                        if (wIdx >= wMin && wIdx < wMax) {
                            let gx, gy, gz;
                            if (wAxis === 2) { gx = u; gy = v; gz = wIdx; }
                            else if (wAxis === 1) { gx = v; gy = wIdx; gz = u; }
                            else { gx = wIdx; gy = u; gz = v; }
                            
                            const lIdx = localIdx(gx, gy, gz);
                            const delta = W - (wIdx + 0.5);
                            const dist2 = delta*delta * distScale;
                            const prev = voxelHits.get(lIdx);
                            
                            if (!prev || dist2 < prev.dist2) {
                                voxelHits.set(lIdx, { tri: t, dist2 });
                            }
                            
                            // Secondary slice for thin geometry
                            const frac = W - wIdx;
                            if (frac < 0.15 || frac > 0.85) {
                                const w2 = (frac < 0.5) ? (wIdx - 1) : (wIdx + 1);
                                if (w2 >= wMin && w2 < wMax) {
                                    let gx2, gy2, gz2;
                                    if (wAxis === 2) { gx2 = u; gy2 = v; gz2 = w2; }
                                    else if (wAxis === 1) { gx2 = v; gy2 = w2; gz2 = u; }
                                    else { gx2 = w2; gy2 = u; gz2 = v; }
                                    
                                    const lIdx2 = localIdx(gx2, gy2, gz2);
                                    const d2b = W - (w2 + 0.5);
                                    const dist2b = d2b*d2b * distScale;
                                    const prev2 = voxelHits.get(lIdx2);
                                    if (!prev2 || dist2b < prev2.dist2) {
                                        voxelHits.set(lIdx2, { tri: t, dist2: dist2b });
                                    }
                                }
                            }
                        }
                    }
                    L0 += dL0du; L1 += dL1du; L2 = 1.0 - L0 - L1; W += dWdu;
                }
            }
        }
        
        // Resolve colors (reuse vectors)
        const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
        const uv0 = new THREE.Vector2(), uv1 = new THREE.Vector2(), uv2 = new THREE.Vector2();
        const e0 = new THREE.Vector3(), e1 = new THREE.Vector3(), ep = new THREE.Vector3();
        
        for (const [lIdx, hit] of voxelHits.entries()) {
            const t = hit.tri;
            const i0 = this.indices[t*3], i1 = this.indices[t*3+1], i2 = this.indices[t*3+2];
            
            v0.fromArray(this.positions, i0*3); v1.fromArray(this.positions, i1*3); v2.fromArray(this.positions, i2*3);
            uv0.fromArray(this.uvs, i0*2); uv1.fromArray(this.uvs, i1*2); uv2.fromArray(this.uvs, i2*2);
            
            const rem = lIdx % (lx * ly);
            const gx = x0 + (rem % lx), gy = y0 + Math.floor(rem / lx), gz = z0 + Math.floor(lIdx / (lx * ly));
            
            const cx = bx + (gx + 0.5) * this.voxelSize;
            const cy = by + (gy + 0.5) * this.voxelSize;
            const cz = bz + (gz + 0.5) * this.voxelSize;
            ep.set(cx, cy, cz);
            
            e0.subVectors(v1, v0); e1.subVectors(v2, v0); ep.subVectors(ep, v0);
            const d00 = e0.dot(e0), d01 = e0.dot(e1), d11 = e1.dot(e1);
            const d20 = ep.dot(e0), d21 = ep.dot(e1);
            const denom = d00*d11 - d01*d01;
            
            let u_b = 0.33, v_b = 0.33, w_b = 0.34;
            if (Math.abs(denom) > 1e-9) {
                const inv = 1.0 / denom;
                v_b = (d11*d20 - d01*d21) * inv;
                w_b = (d00*d21 - d01*d20) * inv;
                u_b = 1.0 - v_b - w_b;
                
                if (u_b < -0.01 || v_b < -0.01 || w_b < -0.01) {
                    const tri = new THREE.Triangle(v0, v1, v2);
                    const closest = tri.closestPointToPoint(ep.set(cx, cy, cz), new THREE.Vector3());
                    ep.subVectors(closest, v0);
                    const d20c = ep.dot(e0), d21c = ep.dot(e1);
                    v_b = (d11*d20c - d01*d21c) * inv;
                    w_b = (d00*d21c - d01*d20c) * inv;
                    u_b = 1.0 - v_b - w_b;
                }
            }
            
            const uvp = new THREE.Vector2(0,0).addScaledVector(uv0, u_b).addScaledVector(uv1, v_b).addScaledVector(uv2, w_b);
            const mat = this.materials[this.triMats[t]] || this.materials[0];
            
            let r = 1, g = 1, b = 1, alpha = 1;
            if (mat && mat.color) { r *= mat.color.r; g *= mat.color.g; b *= mat.color.b; }
            
            if (mat && mat.map) {
                const albedo = sampleAlbedoLinear(mat, uvp, this.imageDatas);
                if (albedo && albedo[3] > ALPHA_CUTOFF) {
                    r *= albedo[0]; g *= albedo[1]; b *= albedo[2];
                    alpha = albedo[3];
                } else if (!albedo || albedo[3] <= ALPHA_CUTOFF) {
                    continue; // Skip transparent voxels
                }
            }
            
            if (mat && mat.emissive) { r += mat.emissive.r; g += mat.emissive.g; b += mat.emissive.b; }
            
            r = Math.min(1, Math.max(0, r));
            g = Math.min(1, Math.max(0, g));
            b = Math.min(1, Math.max(0, b));
            
            let best = 0, bestD = Infinity;
            const K = this.palette.length / 3;
            for (let c = 0; c < K; ++c) {
                const dr = r - this.palette[c*3], dg = g - this.palette[c*3+1], db = b - this.palette[c*3+2];
                const d2 = dr*dr + dg*dg + db*db;
                if (d2 < bestD) { bestD = d2; best = c; }
            }
            paletteStore[lIdx] = best + 1;
        }
        
        return { voxelHits, paletteStore };
    }

    #greedyMeshChunk(x0, x1, y0, y1, z0, z1, paletteStore) {
        const lx = x1 - x0, ly = y1 - y0, lz = z1 - z0;
        const maxMaskSize = Math.max(lx * ly, lx * lz, ly * lz);
        const mask = new Int32Array(maxMaskSize);
        const out = { positions: [], colors8: [], indices: [] };
        
        const sample = (x, y, z) => {
            if (x < 0 || y < 0 || z < 0 || x >= lx || y >= ly || z >= lz) return 0;
            return paletteStore[x + lx * (y + ly * z)];
        };
        
        const bx = this.bbox.min.x, by = this.bbox.min.y, bz = this.bbox.min.z;
        const vs = this.voxelSize;
        
        // Reusable coord arrays
        const x_arr = [0, 0, 0], q_arr = [0, 0, 0];
        const du_arr = [0, 0, 0], dv_arr = [0, 0, 0];
        
        for (let d = 0; d < 3; d++) {
            const u = (d + 1) % 3, v = (d + 2) % 3;
            const l_u = [lx, ly, lz][u], l_v = [lx, ly, lz][v], l_d = [lx, ly, lz][d];
            
            q_arr[0] = q_arr[1] = q_arr[2] = 0; q_arr[d] = 1;
            du_arr[0] = du_arr[1] = du_arr[2] = 0; du_arr[u] = 1;
            dv_arr[0] = dv_arr[1] = dv_arr[2] = 0; dv_arr[v] = 1;
            
            for (x_arr[d] = -1; x_arr[d] < l_d;) {
                let n = 0;
                for (x_arr[v] = 0; x_arr[v] < l_v; x_arr[v]++) {
                    for (x_arr[u] = 0; x_arr[u] < l_u; x_arr[u]++) {
                        const a = sample(x_arr[0], x_arr[1], x_arr[2]);
                        const b = sample(x_arr[0] + q_arr[0], x_arr[1] + q_arr[1], x_arr[2] + q_arr[2]);
                        mask[n++] = (a !== 0 && b !== 0 && a === b) ? 0 : (a !== 0 ? a : -b);
                    }
                }
                x_arr[d]++;
                
                n = 0;
                for (let j = 0; j < l_v; j++) {
                    for (let i = 0; i < l_u;) {
                        const c = mask[n];
                        if (c !== 0) {
                            let w = 1;
                            while (i + w < l_u && mask[n + w] === c) w++;
                            let h = 1;
                            outer: for (; j + h < l_v; h++) {
                                for (let k = 0; k < w; k++) {
                                    if (mask[n + k + h * l_u] !== c) break outer;
                                }
                            }
                            
                            x_arr[u] = i; x_arr[v] = j;
                            const px = x_arr[0], py = x_arr[1], pz = x_arr[2];
                            
                            const P = [bx + (x0 + px) * vs, by + (y0 + py) * vs, bz + (z0 + pz) * vs];
                            const Q = [
                                bx + (x0 + px + du_arr[0]*w) * vs,
                                by + (y0 + py + du_arr[1]*w) * vs,
                                bz + (z0 + pz + du_arr[2]*w) * vs
                            ];
                            const R = [
                                bx + (x0 + px + du_arr[0]*w + dv_arr[0]*h) * vs,
                                by + (y0 + py + du_arr[1]*w + dv_arr[1]*h) * vs,
                                bz + (z0 + pz + du_arr[2]*w + dv_arr[2]*h) * vs
                            ];
                            const S = [
                                bx + (x0 + px + dv_arr[0]*h) * vs,
                                by + (y0 + py + dv_arr[1]*h) * vs,
                                bz + (z0 + pz + dv_arr[2]*h) * vs
                            ];
                            
                            const colId = Math.abs(c) - 1;
                            const R8 = Math.min(255, Math.max(0, (this.palette[colId * 3 + 0] * 255) | 0));
                            const G8 = Math.min(255, Math.max(0, (this.palette[colId * 3 + 1] * 255) | 0));
                            const B8 = Math.min(255, Math.max(0, (this.palette[colId * 3 + 2] * 255) | 0));
                            
                            const base = out.positions.length / 3;
                            out.positions.push(...P, ...Q, ...R, ...S);
                            out.colors8.push(R8,G8,B8,255, R8,G8,B8,255, R8,G8,B8,255, R8,G8,B8,255);
                            
                            if (c > 0) {
                                out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
                            } else {
                                out.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
                            }
                            
                            for (let l = 0; l < h; l++) {
                                for (let k = 0; k < w; k++) {
                                    mask[n + k + l * l_u] = 0;
                                }
                            }
                            i += w; n += w;
                        } else {
                            i++; n++;
                        }
                    }
                }
            }
        }
        
        return {
            positions: new Float32Array(out.positions),
            colors8: new Uint8Array(out.colors8),
            indices: out.positions.length/3 >= 65536 ? new Uint32Array(out.indices) : new Uint16Array(out.indices),
            bounds: {
                min: [bx + x0 * vs, by + y0 * vs, bz + z0 * vs],
                max: [bx + x1 * vs, by + y1 * vs, bz + z1 * vs]
            }
        };
    }

    #sendGeometry(g) {
        const transfer = [g.positions.buffer, g.colors8.buffer, g.indices.buffer];
        self.postMessage({
            status: 'chunk',
            geometry: g
        }, transfer);
    }

    #reportProgress(processed, total) {
        self.postMessage({ status: 'progress', processed, total });
    }
}

self.onmessage = async (event) => {
    try {
        const { modelData, resolution, needGrid, method } = event.data;

        const bbox = new THREE.Box3(
            new THREE.Vector3().fromArray(modelData.bbox.min),
            new THREE.Vector3().fromArray(modelData.bbox.max)
        );
        const size = new THREE.Vector3(); bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const voxelSize = maxDim / resolution;

        const voxelizer = new StreamingVoxelizer();
        await voxelizer.init({ modelData, voxelSize, needGrid, method });

    } catch (error) {
        console.error('Worker error:', error);
        self.postMessage({ status: 'error', message: error.message });
    }
};
