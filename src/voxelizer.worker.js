/* voxelizer.worker.js (OPTIMIZED & FIXED) */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ALPHA_CUTOFF = 0.08; // skip texels with alpha below this to avoid black bleed
const MAX_GRID_VOXELS = 40_000_000; // ~80MB worst case for counts+colors; adjust to taste
const ALPHA_EPS = 1e-3; // minimum alpha for palette inclusion
const DEFAULT_CHUNK_SIZE = 64; // Optimized for speed

class ChunkIndexer {
    constructor(nx, ny, nz, chunkSize = DEFAULT_CHUNK_SIZE) {
        this.nx = Math.max(1, nx | 0);
        this.ny = Math.max(1, ny | 0);
        this.nz = Math.max(1, nz | 0);
        this.chunkSize = chunkSize | 0 || DEFAULT_CHUNK_SIZE;
        this.chunkCountX = Math.max(1, Math.ceil(this.nx / this.chunkSize));
        this.chunkCountY = Math.max(1, Math.ceil(this.ny / this.chunkSize));
        this.chunkCountZ = Math.max(1, Math.ceil(this.nz / this.chunkSize));
        this.layerSize = this.chunkSize * this.chunkSize;
        this.chunkVolume = this.chunkSize * this.chunkSize * this.chunkSize;
    }

    key(cx, cy, cz) {
        return cx + this.chunkCountX * (cy + this.chunkCountY * cz);
    }

    locate(x, y, z) {
        if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return null;
        const cx = Math.floor(x / this.chunkSize);
        const cy = Math.floor(y / this.chunkSize);
        const cz = Math.floor(z / this.chunkSize);
        const lx = x - cx * this.chunkSize;
        const ly = y - cy * this.chunkSize;
        const lz = z - cz * this.chunkSize;
        const localIndex = lx + this.chunkSize * (ly + this.chunkSize * lz);
        return { key: this.key(cx, cy, cz), cx, cy, cz, lx, ly, lz, localIndex };
    }
}

class PaletteChunkStore {
    constructor(nx, ny, nz, chunkSize = DEFAULT_CHUNK_SIZE) {
        this.indexer = new ChunkIndexer(nx, ny, nz, chunkSize);
        this.chunks = new Map();
    }

    set(x, y, z, value) {
        const loc = this.indexer.locate(x, y, z);
        if (!loc) return;
        let chunk = this.chunks.get(loc.key);
        if (!chunk) {
            chunk = { cx: loc.cx, cy: loc.cy, cz: loc.cz, data: new Uint16Array(this.indexer.chunkVolume) };
            this.chunks.set(loc.key, chunk);
        }
        chunk.data[loc.localIndex] = value;
    }

    get(x, y, z) {
        const loc = this.indexer.locate(x, y, z);
        if (!loc) return 0;
        const chunk = this.chunks.get(loc.key);
        if (!chunk) return 0;
        return chunk.data[loc.localIndex] || 0;
    }
}

class ColorChunkStore {
    constructor(nx, ny, nz, chunkSize = DEFAULT_CHUNK_SIZE) {
        this.indexer = new ChunkIndexer(nx, ny, nz, chunkSize);
        this.nx = this.indexer.nx;
        this.ny = this.indexer.ny;
        this.nz = this.indexer.nz;
        this.chunks = new Map();
    }

    accumulate(x, y, z, r, g, b, alpha = 1) {
        const loc = this.indexer.locate(x, y, z);
        if (!loc) return;
        let chunk = this.chunks.get(loc.key);
        if (!chunk) {
            chunk = {
                cx: loc.cx,
                cy: loc.cy,
                cz: loc.cz,
                colors: new Float32Array(this.indexer.chunkVolume * 3),
                alphas: new Float32Array(this.indexer.chunkVolume),
                counts: new Uint32Array(this.indexer.chunkVolume)
            };
            this.chunks.set(loc.key, chunk);
        }
        const base = loc.localIndex * 3;
        chunk.colors[base + 0] += r;
        chunk.colors[base + 1] += g;
        chunk.colors[base + 2] += b;
        chunk.alphas[loc.localIndex] += alpha;
        chunk.counts[loc.localIndex] += 1;
    }

    toDense(total) {
        const voxelColors = new Float32Array(total * 4);
        const voxelCounts = new Uint32Array(total);
        const NX = this.nx;
        const NY = this.ny;
        const NZ = this.nz;
        const CS = this.indexer.chunkSize;
        const layer = this.indexer.layerSize;
        for (const chunk of this.chunks.values()) {
            const baseX = chunk.cx * CS;
            const baseY = chunk.cy * CS;
            const baseZ = chunk.cz * CS;
            for (let i = 0; i < this.indexer.chunkVolume; i++) {
                const cnt = chunk.counts[i];
                if (!cnt) continue;
                const lx = i % CS;
                const ly = ((i / CS) | 0) % CS;
                const lz = (i / layer) | 0;
                const x = baseX + lx;
                const y = baseY + ly;
                const z = baseZ + lz;
                if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) continue;
                const lin = x + NX * (y + NY * z);
                const colorBase = i * 3;
                voxelCounts[lin] = cnt;
                voxelColors[lin * 4 + 0] = chunk.colors[colorBase + 0] / cnt;
                voxelColors[lin * 4 + 1] = chunk.colors[colorBase + 1] / cnt;
                voxelColors[lin * 4 + 2] = chunk.colors[colorBase + 2] / cnt;
                voxelColors[lin * 4 + 3] = chunk.alphas[i] / cnt;
            }
        }
        return { voxelColors, voxelCounts };
    }

    toChunkPayload() {
        const chunks = [];
        for (const chunk of this.chunks.values()) {
            chunks.push({
                coord: [chunk.cx, chunk.cy, chunk.cz],
                colors: chunk.colors,
                alphas: chunk.alphas,
                counts: chunk.counts
            });
        }
        return { chunkSize: this.indexer.chunkSize, chunks };
    }
}

// returns [r,g,b, aWeighted] in *linear*; if no coverage, returns null
function sampleAlbedoLinear(material, uv, imageDatas) {
    let aSum = 0, rSum = 0, gSum = 0, bSum = 0;
    const tex = material.map;
    if (tex) {
        const s = getSampler(tex, imageDatas);
        if (s) {
            const c = s(uv, true); // [r,g,b,a] linear & unpremultiplied
            const a = Math.max(0, Math.min(1, c[3] || 0));
            if (a > 0) { rSum += c[0]*a; gSum += c[1]*a; bSum += c[2]*a; aSum += a; }
        }
    }
    if (aSum <= ALPHA_EPS) return null;
    return [ rSum/aSum, gSum/aSum, bSum/aSum, aSum ];
}

function sampleAlbedoNeighborhood(material, uv, imageDatas) {
    const tex = material.map;
    const s = tex ? getSampler(tex, imageDatas) : null;
    if (!s) return null;
    const du = s._du || 0, dv = s._dv || 0;
    const OFFS = [[0,0],[du,0],[-du,0],[0,dv],[0,-dv]];
    let aSum = 0, rSum = 0, gSum = 0, bSum = 0;
    for (const [ou,ov] of OFFS) {
        const c = s(new THREE.Vector2(uv.x+ou, uv.y+ov), true);
        const a = Math.max(0, Math.min(1, c[3] || 0));
        if (a > 0) { rSum += c[0]*a; gSum += c[1]*a; bSum += c[2]*a; aSum += a; }
    }
    if (aSum <= ALPHA_EPS) return null;
    return [ rSum/aSum, gSum/aSum, bSum/aSum, aSum ];
}

// --- Helper functions ---
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

        // sRGB -> linear helper
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
                let r = data[i] / 255, g = data[i+1] / 255, b = data[i+2] / 255, a = data[i+3] / 255;
                // convert EACH texel to linear before mixing
                if (tex.encoding === THREE.sRGBEncoding) {
                    r = srgbToLin(r); g = srgbToLin(g); b = srgbToLin(b);
                }
                return [r, g, b, a];
            };

            const c00 = sample(x0, y0), c10 = sample(x1, y0), c01 = sample(x0, y1), c11 = sample(x1, y1);
            
            // premultiplied bilinear blend: RGB*A, then divide by A
            const w00 = (1 - tx) * (1 - ty);
            const w10 = tx * (1 - ty);
            const w01 = (1 - tx) * ty;
            const w11 = tx * ty;

            const a = c00[3]*w00 + c10[3]*w10 + c01[3]*w01 + c11[3]*w11;
            let r = c00[0]*c00[3]*w00 + c10[0]*c10[3]*w10 + c01[0]*c01[3]*w01 + c11[0]*c11[3]*w11;
            let g = c00[1]*c00[3]*w00 + c10[1]*c10[3]*w10 + c01[1]*c01[3]*w01 + c11[1]*c11[3]*w11;
            let b = c00[2]*c00[3]*w00 + c10[2]*c10[3]*w10 + c01[2]*c01[3]*w01 + c11[2]*c11[3]*w11;

            if (a > 1e-5) { r /= a; g /= a; b /= a; } // unpremultiply
            else { r = 0; g = 0; b = 0; }             // fully transparent → neutral

            return wantRGBA ? [r, g, b, a] : [r, g, b];
        };
        
        // expose 1-pixel UV deltas for neighborhood taps
        sampler._du = 1 / width;
        sampler._dv = 1 / height;
    }
    _samplers.set(tex, sampler);
    return sampler;
}

const COLOR_MAP_KEYS = ['map']; // only albedo participates in multiplication
function* allTextures(mat) {
    for (const k of COLOR_MAP_KEYS) {
        const t = mat[k];
        if (t && t.isTexture) yield t;
    }
}

function kMeansPalette(colors, k = 64, iters = 8) {
    let n = colors.length / 3;
    const MAX_SAMPLES = 4096;

    // Downsample to a bounded set for stability
    if (n > MAX_SAMPLES) {
        const sampled = new Float32Array(MAX_SAMPLES * 3);
        const step = Math.ceil(n / MAX_SAMPLES);
        let m = 0;
        for (let i = 0; i < n && m < MAX_SAMPLES; i += step) {
            sampled[m*3+0] = colors[i*3+0];
            sampled[m*3+1] = colors[i*3+1];
            sampled[m*3+2] = colors[i*3+2];
            m++;
        }
        colors = sampled;
        n = m; // use actual count, not MAX_SAMPLES
    }

    if (n === 0) return { palette: new Float32Array([1,1,1]) }; // sane fallback (white)

    k = Math.min(k, n);                            // ← important: clamp k to available samples
    const cent = new Float32Array(k * 3);

    // evenly spaced seeds (deterministic)
    for (let c = 0; c < k; ++c) {
        const s = Math.min(n - 1, Math.floor((c + 0.5) * n / k));
        cent[c*3+0] = colors[s*3+0];
        cent[c*3+1] = colors[s*3+1];
        cent[c*3+2] = colors[s*3+2];
    }

    const sums = new Float32Array(k * 3);
    const cnts = new Uint32Array(k);

    for (let it = 0; it < iters; ++it) {
        sums.fill(0); cnts.fill(0);

        // Assignment
        for (let p = 0; p < n; ++p) {
            const r = colors[p*3+0], g = colors[p*3+1], b = colors[p*3+2];
            let best = 0, bestD = Infinity;
            for (let c = 0; c < k; ++c) {
                const dr = r - cent[c*3+0], dg = g - cent[c*3+1], db = b - cent[c*3+2];
                const d2 = dr*dr + dg*dg + db*db;
                if (d2 < bestD) { bestD = d2; best = c; }
            }
            sums[best*3+0] += r; sums[best*3+1] += g; sums[best*3+2] += b; cnts[best]++;
        }

        // Update (with empty-cluster rescue)
        for (let c = 0; c < k; ++c) {
            if (cnts[c] === 0) {
                // Reseed from a random sample to avoid (0,0,0)
                const s = Math.floor(Math.random() * n);
                cent[c*3+0] = colors[s*3+0];
                cent[c*3+1] = colors[s*3+1];
                cent[c*3+2] = colors[s*3+2];
            } else {
                const inv = 1 / cnts[c];
                cent[c*3+0] = sums[c*3+0] * inv;
                cent[c*3+1] = sums[c*3+1] * inv;
                cent[c*3+2] = sums[c*3+2] * inv;
            }
        }
    }

    // optional: push centroids away from exact black unless data demands it
    const MIN_LUMA = 0.015; // ~4/255 – tweak to taste
    for (let c = 0; c < k; ++c) {
        const r = cent[c*3+0], g = cent[c*3+1], b = cent[c*3+2];
        const L = 0.2126*r + 0.7152*g + 0.0722*b;
        if (L < MIN_LUMA) {
            const scale = MIN_LUMA / Math.max(L, 1e-6);
            cent[c*3+0] = Math.min(1, r*scale);
            cent[c*3+1] = Math.min(1, g*scale);
            cent[c*3+2] = Math.min(1, b*scale);
        }
    }

    return { palette: cent };
}

// --- The Main Voxelizer Class ---
class WorkerVoxelizer {
    async init({ modelData, voxelSize, maxGrid = Infinity, paletteSize = 256, needGrid = false, method = '2.5d-scan', onProgress }) {
        this.voxelSize = voxelSize;
        this.paletteSize = paletteSize;
        this.needGrid = needGrid;
        this.method = method;
        this.onProgress = onProgress;
        this.imageDatas = new Map(modelData.imageDatas);

        const model = this.#reconstructModel(modelData);
        const baked = this.#bakeAndMerge(model);
        this.positions = baked.positions; this.uvs = baked.uvs;
        this.indices = baked.indices; this.triMats = baked.triMats;
        this.palette = baked.palette; this.materials = baked.materials;

        this.bbox = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); this.bbox.getSize(size);
        let nx = Math.ceil(size.x/voxelSize), ny = Math.ceil(size.y/voxelSize), nz = Math.ceil(size.z/voxelSize);
        const m = Math.max(nx,ny,nz), scale = Number.isFinite(maxGrid) && m>maxGrid ? maxGrid/m : 1;
        this.grid = new THREE.Vector3(Math.ceil(nx*scale), Math.ceil(ny*scale), Math.ceil(nz*scale));
        this.voxelSize /= scale;

        // Choose rasterization method
        if (this.method === '3d-sat') {
            this.#cpuRasterize3DSAT();
        } else {
            this.#cpuRasterize2D5(); // Default: 2.5D scan converter
        }
        
        this.filledVoxelCount = this._rasterResult?.filledCount ?? 0;
        const result = this.#buildGreedyMeshChunks();   // NEW
        const voxelGridData = this.needGrid ? this.#getVoxelGridData() : null;

        return {
            geometries: result.geometries,
            voxelCount: this.filledVoxelCount,
            voxelGrid: voxelGridData,
        };
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
            for (const [attr, {array, itemSize}] of Object.entries(meshData.geometry.attributes)) {
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
            
            const groups = g.groups.length ? g.groups : [{ start:0, count:posA.count, materialIndex:0 }];
            const uvA  = g.getAttribute('uv');

            for (const grp of groups) {
                const m = meshMats[grp.materialIndex];
                if (!m) continue;
                const baseR = m.color ? m.color.r : 1;
                const baseG = m.color ? m.color.g : 1;
                const baseB = m.color ? m.color.b : 1;
                for (let vi=grp.start; vi<grp.start+grp.count; ++vi) {
                    let r = baseR, g = baseG, b = baseB; let had = false;
                    if (uvA) {
                        const u = uvA.getX(vi), v = uvA.getY(vi);
                        const albedo = sampleAlbedoLinear(m, new THREE.Vector2(u,v), this.imageDatas);
                        if (albedo) { r *= albedo[0]; g *= albedo[1]; b *= albedo[2]; had = true; }
                        if (m.emissive) { r += m.emissive.r; g += m.emissive.g; b += m.emissive.b; }
                        if (m.emissiveMap) { const es = getSampler(m.emissiveMap, this.imageDatas); if (es) { const ec = es(new THREE.Vector2(u,v), true); r += ec[0]; g += ec[1]; b += ec[2]; } }
                    } else {
                        if (m.emissive) { r += m.emissive.r; g += m.emissive.g; b += m.emissive.b; }
                        had = true;
                    }
                    if (!(Number.isFinite(r)&&Number.isFinite(g)&&Number.isFinite(b))) { r=g=b=1; }
                    r = r<0?0:r>1?1:r; g = g<0?0:g>1?1:g; b = b<0?0:b>1?1:b;
                    if (had) allRGB.push(r,g,b);
                }
            }

            if (uvA) { for (let i=0; i<posA.count; ++i) uvs.push(uvA.getX(i), uvA.getY(i)); }
            else { for (let i=0; i<posA.count; ++i) uvs.push(0,0); }

            for (const grp of groups) {
                const m = meshMats[grp.materialIndex];
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
        
        if (geoms.length === 0) return { positions: new Float32Array(), uvs: new Float32Array(), indices: new Uint32Array(), triMats: new Uint32Array(), palette: new Float32Array(), materials: [] };
        
        const merged = mergeGeometries(geoms, false);
        return {
            positions: merged.attributes.position.array, uvs: new Float32Array(uvs),
            indices: new Uint32Array(indices), triMats: new Uint32Array(triMats),
            palette: kMeansPalette(new Float32Array(allRGB), this.paletteSize).palette,
            materials
        };
    }

    #cpuRasterize2D5() {
        const NX = this.grid.x | 0, NY = this.grid.y | 0, NZ = this.grid.z | 0;
        const total = NX * NY * NZ;

        // Outputs (same as before)
        const voxelHits = new Map(); // key -> { tri, dist2 }

        // Helpers
        const index1D = (x,y,z) => x + NX * (y + NY * z);

        // Precompute vertex positions in **voxel space** once
        // pVox[k*3 + 0|1|2] = (pos - bbox.min) / voxelSize
        const pVox = new Float32Array(this.positions.length);
        const invVS = 1 / this.voxelSize;
        const bx = this.bbox.min.x, by = this.bbox.min.y, bz = this.bbox.min.z;

        for (let i = 0, n = this.positions.length / 3; i < n; i++) {
            const x = this.positions[i*3+0], y = this.positions[i*3+1], z = this.positions[i*3+2];
            pVox[i*3+0] = (x - bx) * invVS;
            pVox[i*3+1] = (y - by) * invVS;
            pVox[i*3+2] = (z - bz) * invVS;
        }

        // Temporary scalars
        let uAxis=0, vAxis=1, wAxis=2;

        // For each triangle
        const triCount = (this.indices.length / 3) | 0;
        for (let t = 0; t < triCount; t++) {
            const i0 = this.indices[t*3+0], i1 = this.indices[t*3+1], i2 = this.indices[t*3+2];

            // Fetch vertices in voxel space
            const x0 = pVox[i0*3+0], y0 = pVox[i0*3+1], z0 = pVox[i0*3+2];
            const x1 = pVox[i1*3+0], y1 = pVox[i1*3+1], z1 = pVox[i1*3+2];
            const x2 = pVox[i2*3+0], y2 = pVox[i2*3+1], z2 = pVox[i2*3+2];

            // Triangle normal in voxel space (for major-axis and distance scale)
            const e10x = x1 - x0, e10y = y1 - y0, e10z = z1 - z0;
            const e20x = x2 - x0, e20y = y2 - y0, e20z = z2 - z0;
            const nx = e10y*e20z - e10z*e20y;
            const ny = e10z*e20x - e10x*e20z;
            const nz = e10x*e20y - e10y*e20x;
            const abx = Math.abs(nx), aby = Math.abs(ny), abz = Math.abs(nz);
            const nn  = nx*nx + ny*ny + nz*nz;
            if (nn < 1e-12) continue; // degenerate

            // Choose dominant axis (w), and corresponding 2D projection (u,v)
            if (abx >= aby && abx >= abz) { wAxis = 0; uAxis = 1; vAxis = 2; }     // X-major → (u,v) = (Y,Z)
            else if (aby >= abx && aby >= abz) { wAxis = 1; uAxis = 2; vAxis = 0; } // Y-major → (u,v) = (Z,X)
            else { wAxis = 2; uAxis = 0; vAxis = 1; }                               // Z-major → (u,v) = (X,Y)

            // Read components by axis quickly
            const U0 = (uAxis===0?x0:uAxis===1?y0:z0), V0 = (vAxis===0?x0:vAxis===1?y0:z0), W0 = (wAxis===0?x0:wAxis===1?y0:z0);
            const U1 = (uAxis===0?x1:uAxis===1?y1:z1), V1 = (vAxis===0?x1:vAxis===1?y1:z1), W1 = (wAxis===0?x1:wAxis===1?y1:z1);
            const U2 = (uAxis===0?x2:uAxis===1?y2:z2), V2 = (vAxis===0?x2:vAxis===1?y2:z2), W2 = (wAxis===0?x2:wAxis===1?y2:z2);

            // 2D area (denominator for barycentric); skip near-zero projected area
            const denom = (V1 - V2)*(U0 - U2) + (U2 - U1)*(V0 - V2);
            if (Math.abs(denom) < 1e-12) continue;
            const invDen = 1.0 / denom;

            // Plane interpolation in terms of (u,v): W = λ0*W0 + λ1*W1 + λ2*W2
            // Precompute row/col increments for λ0, λ1 (λ2 = 1 - λ0 - λ1)
            const dL0du = (V1 - V2) * invDen;
            const dL0dv = (U2 - U1) * invDen;
            const dL1du = (V2 - V0) * invDen;
            const dL1dv = (U0 - U2) * invDen;

            // Conservative 2D integer bbox on (u,v); clamp to grid extents
            const uMin = Math.max(0, Math.floor(Math.min(U0, U1, U2)));
            const vMin = Math.max(0, Math.floor(Math.min(V0, V1, V2)));
            const uMax = Math.min((uAxis===0?NX-1:uAxis===1?NY-1:NZ-1), Math.floor(Math.max(U0, U1, U2)));
            const vMax = Math.min((vAxis===0?NX-1:vAxis===1?NY-1:NZ-1), Math.floor(Math.max(V0, V1, V2)));
            if (uMin > uMax || vMin > vMax) continue;

            // Distance scaling: |dist_normal|^2 = (ΔW)^2 * (n_w^2 / |n|^2)
            const nW = (wAxis===0?nx:(wAxis===1?ny:nz));
            const distScale = (nW*nW) / nn;

            // Pixel-center offset (u+0.5, v+0.5)
            const eps = 1e-6; // inside tolerance

            for (let v = vMin; v <= vMax; v++) {
                // λ0, λ1 at (uMin+0.5, v+0.5)
                const uu0 = (uMin + 0.5), vv0 = (v + 0.5);
                let L0 = ((V1 - V2)*(uu0 - U2) + (U2 - U1)*(vv0 - V2)) * invDen;
                let L1 = ((V2 - V0)*(uu0 - U2) + (U0 - U2)*(vv0 - V2)) * invDen;
                let L2 = 1.0 - L0 - L1;

                // Precompute W at start of row and dW/du
                let W = L0*W0 + L1*W1 + L2*W2;
                const dWdu = dL0du*W0 + dL1du*W1 - (dL0du + dL1du)*W2;

                // Row scan
                for (let u = uMin; u <= uMax; u++) {
                    // Inside test using barycentric (top-left rule approx via small epsilon)
                    if (L0 >= -eps && L1 >= -eps && L2 >= -eps) {
                        // Candidate voxel along W (nearest slice)
                        const wIdx = Math.floor(W);
                        // Update up to two nearest slices for conservativeness
                        // primary
                        if (wIdx >= 0 && wIdx < (wAxis===0?NX:(wAxis===1?NY:NZ))) {
                            const delta = W - (wIdx + 0.5);
                            const d2 = delta*delta * distScale;

                            let x = 0, y = 0, z = 0;
                            // Clear branch-based mapping for axis assignment
                            if (wAxis === 2) { // Z-major: (u,v)=(X,Y), W=Z
                                x = u;
                                y = v;
                                z = wIdx;
                            } else if (wAxis === 1) { // Y-major: (u,v)=(Z,X), W=Y
                                z = u;
                                x = v;
                                y = wIdx;
                            } else { // X-major: (u,v)=(Y,Z), W=X
                                y = u;
                                z = v;
                                x = wIdx;
                            }

                            const lin = index1D(x|0, y|0, z|0);
                            const prev = voxelHits.get(lin);
                            if (!prev || d2 < prev.dist2) {
                                voxelHits.set(lin, { tri: t, dist2: d2 });
                            }
                        }

                        // secondary neighbor if plane crosses near boundary (captures thin surfaces)
                        const frac = W - Math.floor(W);
                        if (frac < 0.15 || frac > 0.85) {
                            const w2 = (W - (wIdx + 0.5)) < 0 ? (wIdx - 1) : (wIdx + 1);
                            if (w2 >= 0 && w2 < (wAxis===0?NX:(wAxis===1?NY:NZ))) {
                                let x2=0,y2=0,z2=0;
                                if (wAxis === 2) { x2 = u; y2 = v; z2 = w2; }
                                else if (wAxis === 1) { z2 = u; x2 = v; y2 = w2; }
                                else { y2 = u; z2 = v; x2 = w2; }
                                const lin2 = index1D(x2|0, y2|0, z2|0);
                                const d2b = (W - (w2 + 0.5)); // signed
                                const d2n = d2b*d2b * distScale;
                                const prev2 = voxelHits.get(lin2);
                                if (!prev2 || d2n < prev2.dist2) {
                                    voxelHits.set(lin2, { tri: t, dist2: d2n });
                                }
                            }
                        }
                    }

                    // advance to next pixel in row
                    L0 += dL0du;
                    L1 += dL1du;
                    L2 = 1.0 - L0 - L1;
                    W  += dWdu;
                } // u

                // advance to next row (v+1)
                // (recompute L0, L1 for numerical stability)
                const uu1 = (uMin + 0.5), vv1 = ((v + 1) + 0.5);
                L0 = ((V1 - V2)*(uu1 - U2) + (U2 - U1)*(vv1 - V2)) * invDen;
                L1 = ((V2 - V0)*(uu1 - U2) + (U0 - U2)*(vv1 - V2)) * invDen;
                // L2 implied; W recomputed below for clarity & numeric stability
                const L2row = 1.0 - L0 - L1;
                W = L0*W0 + L1*W1 + L2row*W2;
                // dWdu unchanged per triangle
            } // v
        } // tri loop

        const filledCount = voxelHits.size;
        this.filledVoxelCount = filledCount;
        this._rasterResult = { NX, NY, NZ, voxelHits, filledCount };
    }

    #cpuRasterize3DSAT() {
        const NX = this.grid.x | 0, NY = this.grid.y | 0, NZ = this.grid.z | 0;
        const total = NX * NY * NZ;
        const index1D = (x,y,z) => x + NX * (y + NY * z);
        const voxelHits = new Map();

        const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
        const triBox = new THREE.Box3();
        const voxelCenter = new THREE.Vector3();
        const gridMax = new THREE.Vector3().copy(this.grid).subScalar(1);
        
        // Reused temporaries (no allocations inside loops)
        const tv0 = new THREE.Vector3(), tv1 = new THREE.Vector3(), tv2 = new THREE.Vector3();
        const e0 = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        const n = new THREE.Vector3(), absN = new THREE.Vector3();
        const axisTmp = new THREE.Vector3();

        const numTriangles = this.indices.length / 3;
        for (let i = 0; i < numTriangles; i++) {
            v0.fromArray(this.positions, this.indices[i*3 + 0] * 3);
            v1.fromArray(this.positions, this.indices[i*3 + 1] * 3);
            v2.fromArray(this.positions, this.indices[i*3 + 2] * 3);

            // Triangle AABB in world space
            triBox.setFromPoints([v0, v1, v2]);
            // Expand slightly to be conservative
            triBox.expandByScalar(this.voxelSize * 1e-4);

            // Convert to voxel space
            const vMin = new THREE.Vector3().copy(triBox.min).sub(this.bbox.min).divideScalar(this.voxelSize).floor();
            const vMax = new THREE.Vector3().copy(triBox.max).sub(this.bbox.min).divideScalar(this.voxelSize).floor();

            vMin.clamp(new THREE.Vector3(0,0,0), gridMax);
            vMax.clamp(new THREE.Vector3(0,0,0), gridMax);
            
            e0.subVectors(v1, v0);
            e1.subVectors(v2, v1);
            e2.subVectors(v0, v2);
            n.crossVectors(e0, new THREE.Vector3().subVectors(v2, v0));
            const nn = n.dot(n);
            if (nn < 1e-12) continue;
            absN.set(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z));
            const half = this.voxelSize * 0.5;

            for (let z = vMin.z; z <= vMax.z; z++) {
                for (let y = vMin.y; y <= vMax.y; y++) {
                    for (let x = vMin.x; x <= vMax.x; x++) {
                        voxelCenter.set(x + 0.5, y + 0.5, z + 0.5).multiplyScalar(this.voxelSize).add(this.bbox.min);

                        tv0.subVectors(v0, voxelCenter);
                        tv1.subVectors(v1, voxelCenter);
                        tv2.subVectors(v2, voxelCenter);

                        // 1) normal axis
                        const rP = half * (absN.x + absN.y + absN.z);
                        if (Math.abs(n.dot(tv0)) > rP) continue;

                        // 2) edge x axes (reusing axisTmp, no allocations)
                        const test = (edge, ax, ay, az) => {
                            axisTmp.set(edge.y*az - edge.z*ay, edge.z*ax - edge.x*az, edge.x*ay - edge.y*ax);
                            const l2 = axisTmp.x*axisTmp.x + axisTmp.y*axisTmp.y + axisTmp.z*axisTmp.z;
                            if (l2 < 1e-12) return true;
                            const p0 = axisTmp.dot(tv0), p1 = axisTmp.dot(tv1), p2 = axisTmp.dot(tv2);
                            const mn = Math.min(p0, p1, p2), mx = Math.max(p0, p1, p2);
                            const r  = half * (Math.abs(axisTmp.x) + Math.abs(axisTmp.y) + Math.abs(axisTmp.z));
                            return !(mn > r || mx < -r);
                        };
                        if (!test(e0,1,0,0) || !test(e0,0,1,0) || !test(e0,0,0,1)) continue;
                        if (!test(e1,1,0,0) || !test(e1,0,1,0) || !test(e1,0,0,1)) continue;
                        if (!test(e2,1,0,0) || !test(e2,0,1,0) || !test(e2,0,0,1)) continue;

                        // Record closest triangle
                        const lin = index1D(x,y,z);
                        const dist2 = (n.dot(tv0) * n.dot(tv0)) / nn;
                        const prev = voxelHits.get(lin);
                        if (!prev || dist2 < prev.dist2) {
                            voxelHits.set(lin, { tri: i, dist2 });
                        }
                    }
                }
            }
        }
        const filledCount = voxelHits.size;
        this.filledVoxelCount = filledCount;
        this._rasterResult = { NX, NY, NZ, voxelHits, filledCount };
    }

    // Greedy meshing + chunked output (à la OptiFine/Sodium)
    #buildGreedyMeshChunks() {
      const NX = this.grid.x | 0, NY = this.grid.y | 0, NZ = this.grid.z | 0;
      const total = NX * NY * NZ;

      // 1) Build sparse chunked stores for palette ids and voxel colors
      const CHUNK = DEFAULT_CHUNK_SIZE;
      const paletteStore = new PaletteChunkStore(NX, NY, NZ, CHUNK);
      const colorStore = new ColorChunkStore(NX, NY, NZ, CHUNK);
      const linToSRGB = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1/2.4) - 0.055);
      const v = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
      const uv0 = new THREE.Vector2(), uv1 = new THREE.Vector2(), uv2 = new THREE.Vector2();
      const e0 = new THREE.Vector3(), e1 = new THREE.Vector3(), ep = new THREE.Vector3();

      const { voxelHits } = this._rasterResult;
      if (!voxelHits || voxelHits.size === 0) {
        this._colorStore = colorStore;
        return { geometries: [] };
      }

      for (const [linKey, hit] of voxelHits.entries()) {
        const lin = typeof linKey === 'number' ? linKey : Number(linKey);
        if (!Number.isFinite(lin)) continue;
        const gx = lin % NX;
        const gy = ((lin / NX) | 0) % NY;
        const gz = (lin / (NX*NY)) | 0;
        const triId = hit?.tri;
        if (triId == null || triId < 0) continue;

        // sample color for voxel center using triangle triId
        const i0 = this.indices[triId*3], i1 = this.indices[triId*3+1], i2 = this.indices[triId*3+2];
        v .fromArray(this.positions, i0*3);
        v1.fromArray(this.positions, i1*3);
        v2.fromArray(this.positions, i2*3);
        uv0.fromArray(this.uvs, i0*2);
        uv1.fromArray(this.uvs, i1*2);
        uv2.fromArray(this.uvs, i2*2);

        const center = new THREE.Vector3(
          this.bbox.min.x + (gx + 0.5) * this.voxelSize,
          this.bbox.min.y + (gy + 0.5) * this.voxelSize,
          this.bbox.min.z + (gz + 0.5) * this.voxelSize
        );

        // barycentric at center (fallback to closest point)
        e0.subVectors(v1, v);
        e1.subVectors(v2, v);
        ep.subVectors(center, v);
        const d00 = e0.dot(e0), d01 = e0.dot(e1), d11 = e1.dot(e1);
        const d20 = ep.dot(e0), d21 = ep.dot(e1);
        const denom = d00 * d11 - d01 * d01;
        let u_b = 0.33, v_b = 0.33, w_b = 0.34;
        if (Math.abs(denom) > 1e-9) {
          const inv = 1.0 / denom;
          v_b = (d11 * d20 - d01 * d21) * inv;
          w_b = (d00 * d21 - d01 * d20) * inv;
          u_b = 1.0 - v_b - w_b;
          if (u_b < 0 || v_b < 0 || w_b < 0) {
            const tri = new THREE.Triangle(v, v1, v2);
            const cp = tri.closestPointToPoint(center, new THREE.Vector3());
            ep.subVectors(cp, v);
            const d20c = ep.dot(e0), d21c = ep.dot(e1);
            v_b = (d11 * d20c - d01 * d21c) * inv;
            w_b = (d00 * d21c - d01 * d20c) * inv;
            u_b = 1.0 - v_b - w_b;
          }
        }

        const uvp = new THREE.Vector2(0,0)
          .addScaledVector(uv0, u_b)
          .addScaledVector(uv1, v_b)
          .addScaledVector(uv2, w_b);

        const mat = this.materials[this.triMats[triId]] || this.materials[0];
        let r=1, g=1, b=1;
        if (mat && mat.color) { r *= mat.color.r; g *= mat.color.g; b *= mat.color.b; }
        
        let coverage = 1.0;
        if (mat && mat.map) {
            const albedo = sampleAlbedoLinear(mat, uvp, this.imageDatas)
                        || sampleAlbedoNeighborhood(mat, uvp, this.imageDatas);
            if (albedo) {
                r *= albedo[0]; g *= albedo[1]; b *= albedo[2];
                coverage = Math.max(ALPHA_EPS, Math.min(1, albedo[3] ?? 1));
            }
            // if still no coverage, leave r,g,b as base color (don't multiply by 0)
        }
        
        // emissive add (after albedo)
        if (mat && mat.emissive) { r += mat.emissive.r; g += mat.emissive.g; b += mat.emissive.b; }
        if (mat && mat.emissiveMap) {
          const eSamp = getSampler(mat.emissiveMap, this.imageDatas);
          if (eSamp) {
            const ec = eSamp(uvp, true);
            r += ec[0]; g += ec[1]; b += ec[2];
          }
        }
        
        // Clamp sampled color (defensive)
        r = Math.min(1, Math.max(0, r));
        g = Math.min(1, Math.max(0, g));
        b = Math.min(1, Math.max(0, b));

        // Record true per-voxel averages in sRGB space (for KD queries later)
        const rr = Math.min(1, Math.max(0, linToSRGB(r)));
        const gg = Math.min(1, Math.max(0, linToSRGB(g)));
        const bb = Math.min(1, Math.max(0, linToSRGB(b)));
        colorStore.accumulate(gx, gy, gz, rr, gg, bb, coverage);

        // choose nearest palette entry (use actual palette length!)
        let best = 0, bestD = Infinity;
        const K = (this.palette?.length ?? 0) / 3;
        for (let c = 0; c < K; ++c) {
          const dr = r - this.palette[c*3], dg = g - this.palette[c*3+1], db = b - this.palette[c*3+2];
          const d2 = dr*dr + dg*dg + db*db;
          if (d2 < bestD) { bestD = d2; best = c; }
        }
        paletteStore.set(gx, gy, gz, best + 1); // store +1 to distinguish 0 = empty
      }

      // 2) Greedy mesh per CHUNK (greatly reduces triangles & allows culling)
      const chunks = [];
      const bx = this.bbox.min.x, by = this.bbox.min.y, bz = this.bbox.min.z;
      const vs = this.voxelSize;

      // Reusable mask (max CHUNK*CHUNK)
      const mask = new Int32Array(CHUNK * CHUNK);

      const sample = (x,y,z) => paletteStore.get(x,y,z);

    // helper to emit a quad into arrays with correct winding (no normals)
    function pushQuad(out, p, q, r, s, nrm, colorIdx) {
        const base = out.positions.length / 3;
        // positions
        out.positions.push(
          p[0], p[1], p[2],
          q[0], q[1], q[2],
          r[0], r[1], r[2],
          s[0], s[1], s[2]
        );
                // colors (u8 RGBA packed here)
                const rC = this.palette[(colorIdx)*3+0];
                const gC = this.palette[(colorIdx)*3+1];
                const bC = this.palette[(colorIdx)*3+2];
                const R = Math.max(0,Math.min(255,(rC*255)|0));
                const G = Math.max(0,Math.min(255,(gC*255)|0));
                const B = Math.max(0,Math.min(255,(bC*255)|0));
                const A = 255;
                out.colors8.push(
                    R,G,B,A, R,G,B,A, R,G,B,A, R,G,B,A
                );
        
        // Check winding order and emit triangles with correct CCW orientation
        // Calculate face cross product to determine if we need to flip
        const ax = q[0] - p[0], ay = q[1] - p[1], az = q[2] - p[2]; // edge p->q
        const bx = r[0] - p[0], by = r[1] - p[1], bz = r[2] - p[2]; // edge p->r
        
        // cross = (q - p) × (r - p)
        const cx = ay * bz - az * by;
        const cy = az * bx - ax * bz;
        const cz = ax * by - ay * bx;
        
        // dot with intended outward normal
        const dot = cx * nrm[0] + cy * nrm[1] + cz * nrm[2];
        
        if (dot >= 0) {
          // CCW already → keep original order
          out.indices.push(base+0, base+1, base+2, base+0, base+2, base+3);
        } else {
          // flip winding to make CCW
          out.indices.push(base+0, base+2, base+1, base+0, base+3, base+2);
        }
      }

      // Run greedy meshing within a chunk
      const meshChunk = (cx0, cx1, cy0, cy1, cz0, cz1) => {
    const out = { positions: [], colors8: [], indices: [] };

        // axis loop: 0=X,1=Y,2=Z (like Mikola Lysenko's algorithm)
        for (let d = 0; d < 3; d++) {
          const u = (d + 1) % 3;
          const v = (d + 2) % 3;

          const r0 = [cx0, cy0, cz0];
          const r1 = [cx1, cy1, cz1];

          const minD = (d===0?cx0:(d===1?cy0:cz0));
          const maxD = (d===0?cx1:(d===1?cy1:cz1));

          const minU = (u===0?cx0:(u===1?cy0:cz0));
          const maxU = (u===0?cx1:(u===1?cy1:cz1));

          const minV = (v===0?cx0:(v===1?cy0:cz0));
          const maxV = (v===0?cx1:(v===1?cy1:cz1));

          for (let x = minD; x <= maxD; x++) { // note <= because we compare between x-1 and x
            const nu = (maxU - minU);
            const nv = (maxV - minV);
            if (nu === 0 || nv === 0) continue;

            // build mask for this plane
            const planeSize = nu * nv;
            let n = 0;
            for (let j = minV; j < maxV; j++) {
              for (let i = minU; i < maxU; i++) {
                // get voxel on both sides of the plane
                const a = (d===0) ? sample(x-1, i, j)
                          : (d===1) ? sample(j, x-1, i)   // Y-sweep: (X=j, Y=plane, Z=i)
                          : sample(i, j, x-1);
                const b = (d===0) ? sample(x, i, j)
                          : (d===1) ? sample(j, x, i)
                          : sample(i, j, x);
                let id = 0;
                if ((a !== 0) !== (b !== 0)) {
                  // sign encodes which side is solid; magnitude encodes color id
                  id = (b !== 0 ? +1 : -1) * (b !== 0 ? b : a);
                }
                mask[n++] = id;
              }
            }

            // greedy merge rectangles in mask
            n = 0;
            for (let j = 0; j < nv; j++) {
              for (let i = 0; i < nu; ) {
                const c = mask[n];
                if (c) {
                  // compute width
                  let w = 1;
                  while (i + w < nu && mask[n + w] === c) w++;

                  // compute height
                  let h = 1, k;
                  outer: for (; j + h < nv; h++) {
                    for (k = 0; k < w; k++) {
                      if (mask[n + k + h * nu] !== c) break outer;
                    }
                  }

                  // emit quad for rectangle (i..i+w-1, j..j+h-1)
                  const side = Math.sign(c);            // +1 or -1
                  const colId = Math.abs(c) - 1;       // palette index

                  // corners in voxel grid coords
                  const xPlane = x;                     // face lies on plane 'x' (between x-1 and x)
                  const iu0 = minU + i, iu1 = iu0 + w;
                  const iv0 = minV + j, iv1 = iv0 + h;

                  // build 4 corners in [x,y,z] integer space
                  let p = [0,0,0], q = [0,0,0], r = [0,0,0], s = [0,0,0];
                  if (d === 0) { // X
                    p = [xPlane, iu0, iv0]; q = [xPlane, iu1, iv0];
                    r = [xPlane, iu1, iv1]; s = [xPlane, iu0, iv1];
                  } else if (d === 1) { // Y plane (u = Z, v = X)
                    p = [iv0, xPlane, iu0]; q = [iv1, xPlane, iu0];
                    r = [iv1, xPlane, iu1]; s = [iv0, xPlane, iu1];
                  } else { // Z
                    p = [iu0, iv0, xPlane]; q = [iu1, iv0, xPlane];
                    r = [iu1, iv1, xPlane]; s = [iu0, iv1, xPlane];
                  }

                  // scale to world space
                  const P = [bx + p[0]*vs, by + p[1]*vs, bz + p[2]*vs];
                  const Q = [bx + q[0]*vs, by + q[1]*vs, bz + q[2]*vs];
                  const R = [bx + r[0]*vs, by + r[1]*vs, bz + r[2]*vs];
                  const S = [bx + s[0]*vs, by + s[1]*vs, bz + s[2]*vs];

                  // normals & winding (so they point outward from solid)
                  let nrm = [0,0,0];
                  if (d === 0) { nrm = [ -side, 0, 0]; }  // outward = opposite of solid side
                  if (d === 1) { nrm = [ 0, -side, 0]; }
                  if (d === 2) { nrm = [ 0, 0, -side]; }

                  // Always emit in consistent order - pushQuad will handle winding correction
                  pushQuad.call(this, out, P,Q,R,S, nrm, colId);

                  // zero out the mask we just consumed
                  for (let jj = 0; jj < h; jj++) {
                    for (let ii = 0; ii < w; ii++) {
                      mask[n + ii + jj * nu] = 0;
                    }
                  }
                  i += w; n += w;
                } else {
                  i++; n++;
                }
              }
            } // end sweep over mask rows
          } // end sweep along axis d
        } // end axis loop

        // pack to typed arrays
        const positions = new Float32Array(out.positions);
    const colors8   = new Uint8Array(out.colors8);
    const indices   = positions.length/3 >= 65536 ? new Uint32Array(out.indices) : new Uint16Array(out.indices);

        // chunk bounds in world space (for frustum culling on the main thread)
        const bounds = {
          min: [bx + cx0*vs, by + cy0*vs, bz + cz0*vs],
          max: [bx + cx1*vs, by + cy1*vs, bz + cz1*vs],
        };

    return { positions, colors8, indices, bounds };
      };

      // iterate chunks
      const geometries = [];
      let processedChunks = 0;
      const totalChunks = Math.ceil(NX/CHUNK) * Math.ceil(NY/CHUNK) * Math.ceil(NZ/CHUNK);
      const updateInterval = Math.max(1, Math.floor(totalChunks / 100)); // Update every ~1%

      for (let z0 = 0; z0 < NZ; z0 += CHUNK) {
        for (let y0 = 0; y0 < NY; y0 += CHUNK) {
          for (let x0 = 0; x0 < NX; x0 += CHUNK) {
            const x1 = Math.min(NX, x0 + CHUNK);
            const y1 = Math.min(NY, y0 + CHUNK);
            const z1 = Math.min(NZ, z0 + CHUNK);

            const g = meshChunk(x0, x1, y0, y1, z0, z1);
            if (g.indices.length) geometries.push(g);

            processedChunks++;
            if (this.onProgress && (processedChunks % updateInterval === 0 || processedChunks === totalChunks)) {
                this.onProgress(processedChunks, totalChunks);
            }
          }
        }
      }

      // expose color store for voxel grid serialization
      this._colorStore = colorStore;
      return { geometries };
    }
    
    #getVoxelGridData() {
        const NX = this.grid.x | 0, NY = this.grid.y | 0, NZ = this.grid.z | 0;
        const tot = NX * NY * NZ;
        const base = {
            gridSize: { x: NX, y: NY, z: NZ },
            unit: { x: this.voxelSize, y: this.voxelSize, z: this.voxelSize },
            bbox: { 
                min: [this.bbox.min.x, this.bbox.min.y, this.bbox.min.z],
                max: [this.bbox.max.x, this.bbox.max.y, this.bbox.max.z]
            }
        };

        if (this._colorStore) {
            if (tot <= MAX_GRID_VOXELS) {
                const dense = this._colorStore.toDense(tot);
                base.voxelColors = dense.voxelColors;
                base.voxelCounts = dense.voxelCounts;
                this._colorStore = null;
            } else {
                base.chunked = this._colorStore.toChunkPayload();
                this._colorStore = null;
            }
            return base;
        } else if (this.voxelMap) {
            if (tot > MAX_GRID_VOXELS) {
                console.warn(`Voxel grid too large (${tot} voxels > ${MAX_GRID_VOXELS}). Reduce resolution or zoom in.`);
                return null;
            }
            const voxelColors = new Float32Array(tot * 4);
            const voxelCounts = new Uint32Array(tot);
            // Fallback (pre-greedy path)
            const idxXYZ = (x,y,z) => x + NX * (y + NY * z);
            for (const [key, voxel] of this.voxelMap.entries()) {
                const [x,y,z] = key.split(',').map(Number);
                const i = idxXYZ(x,y,z);
                voxelCounts[i] = 1;
                voxelColors[i * 4 + 0] = voxel.r;
                voxelColors[i * 4 + 1] = voxel.g;
                voxelColors[i * 4 + 2] = voxel.b;
                voxelColors[i * 4 + 3] = 1.0;
            }
            base.voxelColors = voxelColors;
            base.voxelCounts = voxelCounts;
            return base;
        } else {
            // Nothing to export (avoid k-means centroid fallback to keep KD accurate)
            return null;
        }
    }
}

// --- Worker Entry Point ---
self.onmessage = async (event) => {
    try {
        const { modelData, resolution, needGrid = false, method = '2.5d-scan' } = event.data;
        
        const bbox = new THREE.Box3(
            new THREE.Vector3().fromArray(modelData.bbox.min),
            new THREE.Vector3().fromArray(modelData.bbox.max)
        );
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const voxelSize = maxDim / resolution;

        const voxelizer = new WorkerVoxelizer();
        const result = await voxelizer.init({ 
            modelData, 
            voxelSize, 
            needGrid, 
            method,
            onProgress: (current, total) => {
                self.postMessage({ status: 'progress', current, total });
            }
        });
        
        const transferList = [];
        if (result.voxelGrid?.voxelColors) transferList.push(result.voxelGrid.voxelColors.buffer);
        if (result.voxelGrid?.voxelCounts) transferList.push(result.voxelGrid.voxelCounts.buffer);
        if (result.voxelGrid?.chunked?.chunks) {
                for (const chunk of result.voxelGrid.chunked.chunks) {
                    if (chunk.colors) transferList.push(chunk.colors.buffer);
                    if (chunk.alphas) transferList.push(chunk.alphas.buffer);
                    if (chunk.counts) transferList.push(chunk.counts.buffer);
                }
        }
        for (const g of (result.geometries || [])) {
            if (g?.positions?.buffer) transferList.push(g.positions.buffer);
            if (g?.colors8?.buffer)   transferList.push(g.colors8.buffer);
                    if (g?.normals?.buffer)   transferList.push(g.normals.buffer);   // only if present
                    if (g?.indices?.buffer)   transferList.push(g.indices.buffer);
                }

        self.postMessage({ status: 'success', result }, transferList);
    } catch (error) {
        console.error('Error in voxelizer worker:', error);
        self.postMessage({ status: 'error', message: error.message, stack: error.stack });
    }
};
